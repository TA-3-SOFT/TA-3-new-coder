import { ToolImpl } from ".";
import { walkDir } from "../../indexing/walkDir";
import { resolveRelativePathInDir } from "../../util/ideUtils";

export const lsToolImpl: ToolImpl = async (args, extras) => {
  // 处理dirPath参数为undefined的情况，默认使用当前目录
  const dirPath = args.dirPath || ".";
  const uri = await resolveRelativePathInDir(dirPath, extras.ide);
  if (!uri) {
    const errorMsg = `Directory ${dirPath} not found. Make sure to use forward-slash paths. Do not use e.g. "."`;
    console.error(`LSToolImpl: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    const startTime = Date.now();
    const entries = await walkDir(uri, extras.ide, {
      returnRelativeUrisPaths: true,
      include: "both",
      recursive: args.recursive ?? false,
    });
    const elapsed = Date.now() - startTime;

    const content =
      entries.length > 0
        ? entries.join("\n")
        : `No files/folders found in ${dirPath}`;

    return [
      {
        name: "File/folder list",
        description: `Files/folders in ${dirPath}`,
        content,
      },
    ];
  } catch (error) {
    console.error(`LSToolImpl: Error during walkDir execution:`, error);
    throw error;
  }
};
