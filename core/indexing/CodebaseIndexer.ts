import * as fs from "fs/promises";

import { ConfigHandler } from "../config/ConfigHandler.js";
import { IContinueServerClient } from "../continueServer/interface.js";
import { IDE, IndexingProgressUpdate, IndexTag } from "../index.js";
import { extractMinimalStackTraceInfo } from "../util/extractMinimalStackTraceInfo.js";
import { getIndexSqlitePath, getLanceDbPath } from "../util/paths.js";
import { findUriInDirs, getUriPathBasename } from "../util/uri.js";

import { LLMError } from "../llm/index.js";
import { getRootCause } from "../util/errors.js";
import { ChunkCodebaseIndex } from "./chunk/ChunkCodebaseIndex.js";
import { CodeSnippetsCodebaseIndex } from "./CodeSnippetsIndex.js";
import { FullTextSearchCodebaseIndex } from "./FullTextSearchCodebaseIndex.js";
import { LanceDbIndex } from "./LanceDbIndex.js";
import { getComputeDeleteAddRemove } from "./refreshIndex.js";
import {
  CodebaseIndex,
  IndexResultType,
  PathAndCacheKey,
  RefreshIndexResults,
} from "./types.js";
import { walkDirAsync } from "./walkDir.js";

export class PauseToken {
  constructor(private _paused: boolean) {}

  set paused(value: boolean) {
    this._paused = value;
  }

  get paused(): boolean {
    return this._paused;
  }
}

export class CodebaseIndexer {
  /**
   * We batch for two reasons:
   * - To limit memory usage for indexes that perform computations locally, e.g. FTS
   * - To make as few requests as possible to the embeddings providers
   */
  filesPerBatch = 500;

  // Note that we exclude certain Sqlite errors that we do not want to clear the indexes on,
  // e.g. a `SQLITE_BUSY` error.
  errorsRegexesToClearIndexesOn = [
    /Invalid argument error: Values length (d+) is less than the length ((d+)) multiplied by the value size (d+)/,
    /SQLITE_CONSTRAINT/,
    /SQLITE_ERROR/,
    /SQLITE_CORRUPT/,
    /SQLITE_IOERR/,
    /SQLITE_FULL/,
  ];

  constructor(
    private readonly configHandler: ConfigHandler,
    protected readonly ide: IDE,
    private readonly pauseToken: PauseToken,
    private readonly continueServerClient: IContinueServerClient,
  ) {}

  async clearIndexes(dirs?: string[]) {
    // 获取要清除索引的目录列表，如果没有指定则使用当前工作目录
    const targetDirs = dirs ?? (await this.ide.getWorkspaceDirs());

    if (targetDirs.length === 0) {
      console.warn("No directories found for index clearing");
      return;
    }

    // 清除指定目录的索引数据
    for (const dir of targetDirs) {
      await this.clearIndexesForDirectory(dir);
    }
  }

  /**
   * 完全清除所有索引数据（保留作为备用方法）
   * 注意：这会删除所有项目的索引数据，请谨慎使用
   */
  async clearAllIndexes() {
    const sqliteFilepath = getIndexSqlitePath();
    const lanceDbFolder = getLanceDbPath();

    try {
      await fs.unlink(sqliteFilepath);
      console.log(`Deleted SQLite file: ${sqliteFilepath}`);
    } catch (error) {
      console.error(`Error deleting ${sqliteFilepath}:`, error);
    }

    try {
      await fs.rm(lanceDbFolder, { recursive: true, force: true });
      console.log(`Deleted LanceDB folder: ${lanceDbFolder}`);
    } catch (error) {
      console.error(`Error deleting ${lanceDbFolder}:`, error);
    }
  }

  /**
   * 清除指定目录的索引数据（项目特定的清除）
   */
  async clearIndexesForDirectory(directory: string) {
    try {
      // 获取当前分支
      const branch = await this.ide.getBranch(directory);

      // 清除SQLite中的项目特定数据
      await this.clearSqliteIndexesForDirectory(directory, branch);

      // 清除LanceDB中的项目特定表
      await this.clearLanceDbIndexesForDirectory(directory, branch);

      console.log(`Cleared indexes for directory: ${directory}, branch: ${branch}`);
    } catch (error) {
      console.error(`Error clearing indexes for directory ${directory}:`, error);
    }
  }

  /**
   * 清除SQLite中指定目录和分支的索引数据
   */
  private async clearSqliteIndexesForDirectory(directory: string, branch: string) {
    try {
      const { SqliteDb } = await import("./refreshIndex.js");
      const db = await SqliteDb.get();

      // 生成当前项目的tag字符串，用于清除基于tag的表
      const { tagToString } = await import("./utils");
      const indexes = await this.getIndexesToBuild();
      const projectTags = indexes.map(index =>
        tagToString({ directory, branch, artifactId: index.artifactId })
      );

      // 1. 清除tag_catalog表中的项目数据
      await db.run(
        "DELETE FROM tag_catalog WHERE dir = ? AND branch = ?",
        directory,
        branch
      );

      // 2. 清除global_cache表中的项目数据
      await db.run(
        "DELETE FROM global_cache WHERE dir = ? AND branch = ?",
        directory,
        branch
      );

      // 3. 清除lance_db_cache表中的项目数据（如果存在）
      try {
        await db.run(
          "DELETE FROM lance_db_cache WHERE path LIKE ?",
          `${directory}%`
        );
      } catch (error) {
        // lance_db_cache表可能不存在，忽略错误
        console.debug("lance_db_cache table not found or error clearing:", error);
      }

      // 4. 清除code_snippets相关表
      await this.clearCodeSnippetsTables(db, projectTags, directory);

      // 5. 清除chunks相关表
      await this.clearChunksTables(db, projectTags, directory);

      // 6. 清除全文搜索相关表
      await this.clearFullTextSearchTables(db, directory);

      console.log(`Cleared SQLite indexes for directory: ${directory}, branch: ${branch}`);
    } catch (error) {
      console.error(`Error clearing SQLite indexes for directory ${directory}:`, error);
    }
  }

  /**
   * 清除code_snippets相关表的项目数据
   */
  private async clearCodeSnippetsTables(db: any, projectTags: string[], directory: string) {
    try {
      // 删除code_snippets_tags表中的项目数据
      if (projectTags.length > 0) {
        const placeholders = projectTags.map(() => '?').join(',');
        await db.run(
          `DELETE FROM code_snippets_tags WHERE tag IN (${placeholders})`,
          ...projectTags
        );
      }

      // 删除没有关联tags的code_snippets记录（路径匹配的）
      await db.run(
        `DELETE FROM code_snippets
         WHERE path LIKE ?
         AND id NOT IN (SELECT DISTINCT snippetId FROM code_snippets_tags)`,
        `${directory}%`
      );

      console.log(`Cleared code_snippets tables for directory: ${directory}`);
    } catch (error) {
      console.debug("Error clearing code_snippets tables:", error);
    }
  }

  /**
   * 清除chunks相关表的项目数据
   */
  private async clearChunksTables(db: any, projectTags: string[], directory: string) {
    try {
      // 删除chunk_tags表中的项目数据
      if (projectTags.length > 0) {
        const placeholders = projectTags.map(() => '?').join(',');
        await db.run(
          `DELETE FROM chunk_tags WHERE tag IN (${placeholders})`,
          ...projectTags
        );
      }

      // 删除没有关联tags的chunks记录（路径匹配的）
      await db.run(
        `DELETE FROM chunks
         WHERE path LIKE ?
         AND id NOT IN (SELECT DISTINCT chunkId FROM chunk_tags)`,
        `${directory}%`
      );

      console.log(`Cleared chunks tables for directory: ${directory}`);
    } catch (error) {
      console.debug("Error clearing chunks tables:", error);
    }
  }

  /**
   * 清除全文搜索相关表的项目数据
   */
  private async clearFullTextSearchTables(db: any, directory: string) {
    try {
      // 获取要删除的fts_metadata记录的ID
      const ftsMetadataRows = await db.all(
        "SELECT id FROM fts_metadata WHERE path LIKE ?",
        `${directory}%`
      );

      if (ftsMetadataRows.length > 0) {
        const ftsIds = ftsMetadataRows.map((row: any) => row.id);
        const placeholders = ftsIds.map(() => '?').join(',');

        // 删除fts虚拟表中的记录
        await db.run(
          `DELETE FROM fts WHERE rowid IN (${placeholders})`,
          ...ftsIds
        );

        // 删除fts_metadata表中的记录
        await db.run(
          `DELETE FROM fts_metadata WHERE path LIKE ?`,
          `${directory}%`
        );
      }

      console.log(`Cleared full-text search tables for directory: ${directory}`);
    } catch (error) {
      console.debug("Error clearing full-text search tables:", error);
    }
  }

  /**
   * 清除LanceDB中指定目录和分支的索引表
   */
  private async clearLanceDbIndexesForDirectory(directory: string, branch: string) {
    try {
      const { config } = await this.configHandler.loadConfig();
      if (!config?.selectedModelByRole.embed) {
        console.log("No embedding model configured, skipping LanceDB cleanup");
        return;
      }

      // 动态导入LanceDB以避免在不支持的平台上加载
      const { isSupportedLanceDbCpuTargetForLinux } = await import("../config/util");
      if (!isSupportedLanceDbCpuTargetForLinux()) {
        console.log("LanceDB not supported on this platform, skipping LanceDB cleanup");
        return;
      }

      let lance;
      try {
        lance = await import("vectordb");
      } catch (err) {
        console.log("Failed to load LanceDB, skipping LanceDB cleanup:", err);
        return;
      }

      const lanceDbPath = getLanceDbPath();

      // 检查LanceDB目录是否存在
      try {
        await fs.access(lanceDbPath);
      } catch {
        console.log("LanceDB directory does not exist, skipping LanceDB cleanup");
        return;
      }

      const db = await lance.connect(lanceDbPath);
      const tableNames = await db.tableNames();

      // 获取所有可能的artifactId
      const indexes = await this.getIndexesToBuild();
      const artifactIds = indexes.map(index => index.artifactId);

      // 为每个artifactId生成对应的表名并删除
      for (const artifactId of artifactIds) {
        const tag = { directory, branch, artifactId };
        const { tagToString } = await import("./utils");
        const tableName = tagToString(tag).replace(/[^\w-_.]/g, "");

        if (tableNames.includes(tableName)) {
          try {
            await db.dropTable(tableName);
            console.log(`Dropped LanceDB table: ${tableName}`);
          } catch (error) {
            console.error(`Error dropping LanceDB table ${tableName}:`, error);
          }
        }
      }

      console.log(`Cleared LanceDB indexes for directory: ${directory}, branch: ${branch}`);
    } catch (error) {
      console.error(`Error clearing LanceDB indexes for directory ${directory}:`, error);
    }
  }

  protected async getIndexesToBuild(): Promise<CodebaseIndex[]> {
    const { config } = await this.configHandler.loadConfig();
    if (!config) {
      return [];
    }

    const embeddingsModel = config.selectedModelByRole.embed;
    if (!embeddingsModel) {
      return [];
    }

    const indexes: CodebaseIndex[] = [
      new ChunkCodebaseIndex(
        this.ide.readFile.bind(this.ide),
        this.continueServerClient,
        embeddingsModel.maxEmbeddingChunkSize,
      ), // Chunking must come first
    ];

    const lanceDbIndex = await LanceDbIndex.create(
      embeddingsModel,
      this.ide.readFile.bind(this.ide),
    );

    if (lanceDbIndex) {
      indexes.push(lanceDbIndex);
    }

    indexes.push(
      new FullTextSearchCodebaseIndex(),
      new CodeSnippetsCodebaseIndex(this.ide),
    );

    return indexes;
  }

  private totalIndexOps(results: RefreshIndexResults): number {
    return (
      results.compute.length +
      results.del.length +
      results.addTag.length +
      results.removeTag.length
    );
  }

  private singleFileIndexOps(
    results: RefreshIndexResults,
    lastUpdated: PathAndCacheKey[],
    filePath: string,
  ): [RefreshIndexResults, PathAndCacheKey[]] {
    const filterFn = (item: PathAndCacheKey) => item.path === filePath;
    const compute = results.compute.filter(filterFn);
    const del = results.del.filter(filterFn);
    const addTag = results.addTag.filter(filterFn);
    const removeTag = results.removeTag.filter(filterFn);
    const newResults = {
      compute,
      del,
      addTag,
      removeTag,
    };
    const newLastUpdated = lastUpdated.filter(filterFn);
    return [newResults, newLastUpdated];
  }

  public async refreshFile(
    file: string,
    workspaceDirs: string[],
  ): Promise<void> {
    if (this.pauseToken.paused) {
      // NOTE: by returning here, there is a chance that while paused a file is modified and
      // then after unpausing the file is not reindexed
      return;
    }
    const { foundInDir } = findUriInDirs(file, workspaceDirs);
    if (!foundInDir) {
      return;
    }
    const branch = await this.ide.getBranch(foundInDir);
    const repoName = await this.ide.getRepoName(foundInDir);
    const indexesToBuild = await this.getIndexesToBuild();
    const stats = await this.ide.getFileStats([file]);
    const filePath = Object.keys(stats)[0];
    for (const index of indexesToBuild) {
      const tag = {
        directory: foundInDir,
        branch,
        artifactId: index.artifactId,
      };
      const [fullResults, fullLastUpdated, markComplete] =
        await getComputeDeleteAddRemove(
          tag,
          { ...stats },
          (filepath) => this.ide.readFile(filepath),
          repoName,
        );

      const [results, lastUpdated] = this.singleFileIndexOps(
        fullResults,
        fullLastUpdated,
        filePath,
      );
      // Don't update if nothing to update. Some of the indices might do unnecessary setup work
      if (this.totalIndexOps(results) + lastUpdated.length === 0) {
        continue;
      }

      for await (const _ of index.update(
        tag,
        results,
        markComplete,
        repoName,
      )) {
      }
    }
  }

  async *refreshFiles(files: string[]): AsyncGenerator<IndexingProgressUpdate> {
    let progress = 0;
    if (files.length === 0) {
      yield {
        progress: 1,
        desc: "Indexing Complete",
        status: "done",
      };
    }

    const workspaceDirs = await this.ide.getWorkspaceDirs();

    const progressPer = 1 / files.length;
    try {
      for (const file of files) {
        yield {
          progress,
          desc: `Indexing file ${file}...`,
          status: "indexing",
        };
        await this.refreshFile(file, workspaceDirs);

        progress += progressPer;

        if (this.pauseToken.paused) {
          yield* this.yieldUpdateAndPause();
        }
      }

      yield {
        progress: 1,
        desc: "Indexing Complete",
        status: "done",
      };
    } catch (err) {
      yield this.handleErrorAndGetProgressUpdate(err);
    }
  }

  async *refreshDirs(
    dirs: string[],
    abortSignal: AbortSignal,
  ): AsyncGenerator<IndexingProgressUpdate> {
    let progress = 0;

    if (dirs.length === 0) {
      yield {
        progress: 1,
        desc: "Nothing to index",
        status: "done",
      };
      return;
    }

    const { config } = await this.configHandler.loadConfig();
    if (!config) {
      return;
    }
    if (config.disableIndexing) {
      yield {
        progress,
        desc: "Indexing is disabled in config.json",
        status: "disabled",
      };
      return;
    } else {
      yield {
        progress,
        desc: "Starting indexing",
        status: "loading",
      };
    }

    // Wait until Git Extension has loaded to report progress
    // so we don't appear stuck at 0% while waiting
    await this.ide.getRepoName(dirs[0]);

    yield {
      progress,
      desc: "Starting indexing...",
      status: "loading",
    };
    const beginTime = Date.now();

    for (const directory of dirs) {
      const dirBasename = getUriPathBasename(directory);
      yield {
        progress,
        desc: `Discovering files in ${dirBasename}...`,
        status: "indexing",
      };
      const directoryFiles = [];
      for await (const p of walkDirAsync(directory, this.ide, {
        source: "codebase indexing: refresh dirs",
      })) {
        directoryFiles.push(p);
        if (abortSignal.aborted) {
          yield {
            progress: 0,
            desc: "Indexing cancelled",
            status: "cancelled",
          };
          return;
        }
        if (this.pauseToken.paused) {
          yield* this.yieldUpdateAndPause();
        }
      }

      const branch = await this.ide.getBranch(directory);
      const repoName = await this.ide.getRepoName(directory);
      let nextLogThreshold = 0;

      try {
        for await (const updateDesc of this.indexFiles(
          directory,
          directoryFiles,
          branch,
          repoName,
        )) {
          // Handle pausing in this loop because it's the only one really taking time
          if (abortSignal.aborted) {
            yield {
              progress: 0,
              desc: "Indexing cancelled",
              status: "cancelled",
            };
            return;
          }
          if (this.pauseToken.paused) {
            yield* this.yieldUpdateAndPause();
          }
          yield updateDesc;
          if (updateDesc.progress >= nextLogThreshold) {
            // log progress every 2.5%
            nextLogThreshold += 0.025;
            this.logProgress(
              beginTime,
              Math.floor(directoryFiles.length * updateDesc.progress),
              updateDesc.progress,
            );
          }
        }
      } catch (err) {
        yield this.handleErrorAndGetProgressUpdate(err);
        return;
      }
    }
    yield {
      progress: 1,
      desc: "Indexing Complete",
      status: "done",
    };
    this.logProgress(beginTime, 0, 1);
  }

  private handleErrorAndGetProgressUpdate(
    err: unknown,
  ): IndexingProgressUpdate {
    console.log("error when indexing: ", err);
    if (err instanceof Error) {
      const cause = getRootCause(err);
      if (cause instanceof LLMError) {
        throw cause;
      }
      return this.errorToProgressUpdate(err);
    }
    return {
      progress: 0,
      desc: `Indexing failed: ${err}`,
      status: "failed",
      debugInfo: extractMinimalStackTraceInfo((err as any)?.stack),
    };
  }

  private errorToProgressUpdate(err: Error): IndexingProgressUpdate {
    const cause = getRootCause(err);
    let errMsg: string = `${cause}`;
    let shouldClearIndexes = false;

    // Check if any of the error regexes match
    for (const regexStr of this.errorsRegexesToClearIndexesOn) {
      const regex = new RegExp(regexStr);
      const match = err.message.match(regex);

      if (match !== null) {
        shouldClearIndexes = true;
        break;
      }
    }

    return {
      progress: 0,
      desc: errMsg,
      status: "failed",
      shouldClearIndexes,
      debugInfo: extractMinimalStackTraceInfo(err.stack),
    };
  }

  private logProgress(
    beginTime: number,
    completedFileCount: number,
    progress: number,
  ) {
    const timeTaken = Date.now() - beginTime;
    const seconds = Math.round(timeTaken / 1000);
    const progressPercentage = (progress * 100).toFixed(1);
    const filesPerSec = (completedFileCount / seconds).toFixed(2);
    // console.debug(
    //   `Indexing: ${progressPercentage}% complete, elapsed time: ${seconds}s, ${filesPerSec} file/sec`,
    // );
  }

  private async *yieldUpdateAndPause(): AsyncGenerator<IndexingProgressUpdate> {
    yield {
      progress: 0,
      desc: "Indexing Paused",
      status: "paused",
    };
    while (this.pauseToken.paused) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /*
   * Enables the indexing operation to be completed in batches, this is important in large
   * repositories where indexing can quickly use up all the memory available
   */
  private *batchRefreshIndexResults(
    results: RefreshIndexResults,
  ): Generator<RefreshIndexResults> {
    let curPos = 0;
    while (
      curPos < results.compute.length ||
      curPos < results.del.length ||
      curPos < results.addTag.length ||
      curPos < results.removeTag.length
    ) {
      yield {
        compute: results.compute.slice(curPos, curPos + this.filesPerBatch),
        del: results.del.slice(curPos, curPos + this.filesPerBatch),
        addTag: results.addTag.slice(curPos, curPos + this.filesPerBatch),
        removeTag: results.removeTag.slice(curPos, curPos + this.filesPerBatch),
      };
      curPos += this.filesPerBatch;
    }
  }

  private async *indexFiles(
    directory: string,
    files: string[],
    branch: string,
    repoName: string | undefined,
  ): AsyncGenerator<IndexingProgressUpdate> {
    const stats = await this.ide.getFileStats(files);
    const indexesToBuild = await this.getIndexesToBuild();
    let completedIndexCount = 0;
    let progress = 0;
    for (const codebaseIndex of indexesToBuild) {
      const tag: IndexTag = {
        directory,
        branch,
        artifactId: codebaseIndex.artifactId,
      };
      yield {
        progress: progress,
        desc: `Planning changes for ${codebaseIndex.artifactId} index...`,
        status: "indexing",
      };
      const [results, lastUpdated, markComplete] =
        await getComputeDeleteAddRemove(
          tag,
          { ...stats },
          (filepath) => this.ide.readFile(filepath),
          repoName,
        );
      const totalOps = this.totalIndexOps(results);
      let completedOps = 0;

      // Don't update if nothing to update. Some of the indices might do unnecessary setup work
      if (totalOps > 0) {
        for (const subResult of this.batchRefreshIndexResults(results)) {
          for await (const { desc } of codebaseIndex.update(
            tag,
            subResult,
            markComplete,
            repoName,
          )) {
            yield {
              progress: progress,
              desc,
              status: "indexing",
            };
          }
          completedOps +=
            subResult.compute.length +
            subResult.del.length +
            subResult.addTag.length +
            subResult.removeTag.length;
          progress =
            (completedIndexCount + completedOps / totalOps) *
            (1 / indexesToBuild.length);
        }
      }

      await markComplete(lastUpdated, IndexResultType.UpdateLastUpdated);
      completedIndexCount += 1;
    }
  }
}
