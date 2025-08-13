import { resolveRelativePathInDir } from "../../util/ideUtils";
import { getUriPathBasename } from "../../util/uri";
import { ToolImpl } from ".";

export const readFileRangeImpl: ToolImpl = async (args, extras) => {
  const { filepath, startLine, endLine } = args;
  
  // 解析文件路径
  const firstUriMatch = await resolveRelativePathInDir(filepath, extras.ide);
  if (!firstUriMatch) {
    throw new Error(`无法找到文件: ${filepath}`);
  }
  
  // 读取完整文件内容
  const fullContent = await extras.ide.readFile(firstUriMatch);
  const lines = fullContent.split('\n');
  
  // 验证行号范围
  if (startLine < 1) {
    throw new Error(`起始行号必须大于等于1，当前值: ${startLine}`);
  }
  
  if (endLine !== -1 && endLine < startLine) {
    throw new Error(`结束行号(${endLine})不能小于起始行号(${startLine})`);
  }
  
  // 计算实际的结束行号
  const actualEndLine = endLine === -1 ? lines.length : Math.min(endLine, lines.length);
  
  // 提取指定范围的行（转换为0基索引）
  const selectedLines = lines.slice(startLine - 1, actualEndLine);
  const rangeContent = selectedLines.join('\n');
  
  // 构建描述信息
  const totalLines = lines.length;
  const actualRange = endLine === -1 ? `${startLine}-${totalLines}` : `${startLine}-${actualEndLine}`;
  
  return [
    {
      name: `${getUriPathBasename(filepath)} (行 ${actualRange})`,
      description: `${filepath} 的第 ${actualRange} 行内容`,
      content: rangeContent,
      uri: {
        type: "file",
        value: firstUriMatch,
      },
    },
  ];
};
