import React, { useState } from "react";
import { useWebviewListener } from "../../../hooks/useWebviewListener";

const AskIcon = () => {
  // 使用状态来管理主题，确保在主题变化时重新渲染
  const [isLightTheme, setIsLightTheme] = useState(() => {
    // 初始化时检查主题
    const editorBg = getComputedStyle(document.documentElement)
      .getPropertyValue("--vscode-editor-background")
      .trim();
    return (
      editorBg === "#ffffff" ||
      editorBg === "rgb(255, 255, 255)" ||
      (editorBg.startsWith("#") && parseInt(editorBg.slice(1), 16) > 0x808080)
    );
  });

  // 更新主题状态的函数
  const updateTheme = () => {
    const editorBg = getComputedStyle(document.documentElement)
      .getPropertyValue("--vscode-editor-background")
      .trim();
    const newIsLightTheme =
      editorBg === "#ffffff" ||
      editorBg === "rgb(255, 255, 255)" ||
      (editorBg.startsWith("#") && parseInt(editorBg.slice(1), 16) > 0x808080);
    setIsLightTheme(newIsLightTheme);
  };

  // 监听JetBrains主题变化消息
  useWebviewListener(
    "jetbrains/setColors",
    async (data) => {
      // 延迟一点时间确保CSS变量已经更新
      setTimeout(updateTheme, 50);
    },
    [],
  );

  // 监听VSCode主题变化消息
  useWebviewListener(
    "setTheme",
    async (data) => {
      setTimeout(updateTheme, 50);
    },
    [],
  );

  // 根据主题选择不同的颜色，如果没有传入自定义颜色则使用主题颜色
  const primaryColor = isLightTheme ? "#02389D" : "#8B5CF6";
  const secondaryColor = isLightTheme ? "#F9C003" : "#F59E0B";

  return (
    <svg
      viewBox="0 0 1024 1024"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
    >
      <path
        d="M884.2 665.7H268c-6.6 0-12-5.4-12-12v-387c0-6.6 5.4-12 12-12h616.2c6.6 0 12 5.4 12 12v387c0 6.6-5.4 12-12 12z"
        fill={primaryColor}
      ></path>
      <path
        d="M819.2 800H203c-6.6 0-12-5.4-12-12V401c0-6.6 5.4-12 12-12h616.2c6.6 0 12 5.4 12 12v387c0 6.6-5.4 12-12 12z"
        fill={secondaryColor}
      ></path>
      <path d="M384.1 895.6l71.3-142.8H312.8z" fill={secondaryColor}></path>
      <path d="M768.1 145.1l-71.3 113.6h142.7z" fill={primaryColor}></path>
      <path
        d="M320.1 608.2m-43 0a43 43 0 1 0 86 0 43 43 0 1 0-86 0Z"
        fill={primaryColor}
      ></path>
      <path
        d="M511.3 608.2m-43 0a43 43 0 1 0 86 0 43 43 0 1 0-86 0Z"
        fill={primaryColor}
      ></path>
      <path
        d="M704.1 608.2m-43 0a43 43 0 1 0 86 0 43 43 0 1 0-86 0Z"
        fill={primaryColor}
      ></path>
    </svg>
  );
};

export default AskIcon;
