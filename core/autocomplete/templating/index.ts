import Handlebars from "handlebars";

import { CompletionOptions } from "../..";
import { AutocompleteLanguageInfo } from "../constants/AutocompleteLanguageInfo";
import { HelperVars } from "../util/HelperVars";

import { SnippetPayload } from "../snippets";
import {
  AutocompleteTemplate,
  getTemplateForModel,
} from "./AutocompleteTemplate";
import { getSnippets } from "./filtering";
import { getUriPathBasename } from "../../util/uri";
import { formatSnippets } from "./formatting";
import { getStopTokens } from "./getStopTokens";

function getTemplate(helper: HelperVars): AutocompleteTemplate {
  if (helper.options.template) {
    return {
      template: helper.options.template,
      completionOptions: {},
      compilePrefixSuffix: undefined,
    };
  }
  return getTemplateForModel(helper.modelName);
}

function renderStringTemplate(
  template: string,
  prefix: string,
  suffix: string,
  lang: AutocompleteLanguageInfo,
  filepath: string,
  reponame: string,
) {
  const filename = getUriPathBasename(filepath);
  const compiledTemplate = Handlebars.compile(template);

  return compiledTemplate({
    prefix,
    suffix,
    filename,
    reponame,
    language: lang.name,
  });
}

export function renderPrompt({
  snippetPayload,
  workspaceDirs,
  helper,
}: {
  snippetPayload: SnippetPayload;
  workspaceDirs: string[];
  helper: HelperVars;
}): {
  prompt: string;
  prefix: string;
  suffix: string;
  completionOptions: Partial<CompletionOptions> | undefined;
} {
  // If prefix is manually passed
  let prefix = helper.input.manuallyPassPrefix || helper.prunedPrefix;
  let suffix = helper.input.manuallyPassPrefix ? "" : helper.prunedSuffix;
  if (suffix === "") {
    suffix = "\n";
  }

  const reponame = getUriPathBasename(workspaceDirs[0] ?? "myproject");

  const { template, compilePrefixSuffix, completionOptions } =
    getTemplate(helper);

  const snippets = getSnippets(helper, snippetPayload);

  // Some models have prompts that need two passes. This lets us pass the compiled prefix/suffix
  // into either the 2nd template to generate a raw string, or to pass prefix, suffix to a FIM endpoint
  if (compilePrefixSuffix) {
    [prefix, suffix] = compilePrefixSuffix(
      prefix,
      suffix,
      helper.filepath,
      reponame,
      snippets,
      helper.workspaceUris,
    );
  } else {
    const formattedSnippets = formatSnippets(helper, snippets, workspaceDirs);
    if (helper.input.symbolTable) {
      prefix = [
        "以下是当前文件关联代码文件的符号表，该符号表是当前文件所直接引用的代码文件，包含应用文件的公共方法和属性，供代码补全时参考使用：",
        helper.input.symbolTable,
        "以下是当前文件代码补全的前缀prefix的代码：",
        formattedSnippets,
        prefix,
      ].join("\n\n");
    } else {
      prefix = [formattedSnippets, prefix].join("\n");
    }
  }

  const prompt =
    // Templates can be passed as a Handlebars template string or a function
    typeof template === "string"
      ? renderStringTemplate(
          template,
          prefix,
          suffix,
          helper.lang,
          helper.filepath,
          reponame,
        )
      : template(
          prefix,
          suffix,
          helper.filepath,
          reponame,
          helper.lang.name,
          snippets,
          helper.workspaceUris,
        );

  const stopTokens = getStopTokens(
    completionOptions,
    helper.lang,
    helper.modelName,
  );

  return {
    prompt,
    prefix,
    suffix,
    completionOptions: {
      ...completionOptions,
      stop: stopTokens,
    },
  };
}
