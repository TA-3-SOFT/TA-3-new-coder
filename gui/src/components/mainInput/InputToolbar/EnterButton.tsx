import styled from "styled-components";
import {
  defaultBorderRadius,
  lightGray,
  vscButtonBackground,
  vscButtonForeground,
  vscForeground,
} from "../..";
import { fontSize } from "../../../util";
import { varWithFallback } from "../../../styles/theme";

export const EnterButton = styled.button<{
  isPrimary?: boolean;
  variant?: "default" | "danger" | "warning" | "success";
}>`
  all: unset;
  font-size: ${fontSize(-3)};
  padding: 2px 4px;
  display: flex;
  align-items: center;
  background-color: ${(props) => {
    if (props.disabled) return lightGray + "33";

    if (props.variant === "danger") {
      return varWithFallback("error");
    }

    if (props.variant === "warning") {
      return varWithFallback("warning");
    }

    if (props.variant === "success") {
      return varWithFallback("success");
    }

    return props.isPrimary ? vscButtonBackground : lightGray + "33";
  }};
  border-radius: ${defaultBorderRadius};
  color: ${(props) => {
    if (props.disabled) return vscForeground;

    if (
      props.variant === "danger" ||
      props.variant === "warning" ||
      props.variant === "success"
    ) {
      return "#ffffff";
    }

    return props.isPrimary ? vscButtonForeground : vscForeground;
  }};
  cursor: pointer;

  :disabled {
    cursor: not-allowed;
  }

  :hover:not(:disabled) {
    filter: brightness(1.1);
  }
`;
