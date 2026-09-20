import { RefineThemes } from "@refinedev/antd";
import { ConfigProvider, theme } from "antd";
import {
  type PropsWithChildren,
  createContext,
  useEffect,
  useState,
} from "react";

type ColorModeContextType = {
  mode: string;
  setMode: (mode: string) => void;
};

export const ColorModeContext = createContext<ColorModeContextType>(
  {} as ColorModeContextType
);

export const ColorModeContextProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const colorModeFromLocalStorage = localStorage.getItem("colorMode");
  const isSystemPreferenceDark = window?.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches;

  const systemPreference = isSystemPreferenceDark ? "dark" : "light";
  const [mode, setMode] = useState(
    colorModeFromLocalStorage || systemPreference
  );

  useEffect(() => {
    window.localStorage.setItem("colorMode", mode);
    document.documentElement.setAttribute("data-theme", mode);
    if (mode === "dark") {
      document.body.style.backgroundColor = "#12151b";
      document.body.style.color = "rgba(255, 255, 255, 0.90)";
    } else {
      document.body.style.backgroundColor = "#f5f7fa";
      document.body.style.color = "rgba(0, 0, 0, 0.88)";
    }
  }, [mode]);

  const setColorMode = () => {
    if (mode === "light") {
      setMode("dark");
    } else {
      setMode("light");
    }
  };

  const { darkAlgorithm, defaultAlgorithm } = theme;

  const darkThemeConfig = {
    ...RefineThemes.Blue,
    algorithm: darkAlgorithm,
    token: {
      ...RefineThemes.Blue.token,
      // 舒适温和的暗色护眼色调（避免死黑/过暗）
      colorBgBase: "#181b22",
      colorBgLayout: "#12151b",
      colorBgContainer: "#1f242d",
      colorBgElevated: "#272d38",
      colorBorder: "#343c4c",
      colorBorderSecondary: "#2b3240",
      colorText: "rgba(255, 255, 255, 0.90)",
      colorTextSecondary: "rgba(255, 255, 255, 0.65)",
      colorTextTertiary: "rgba(255, 255, 255, 0.45)",
    },
  };

  const lightThemeConfig = {
    ...RefineThemes.Blue,
    algorithm: defaultAlgorithm,
    token: {
      ...RefineThemes.Blue.token,
      colorBgLayout: "#f5f7fa",
      colorBgContainer: "#ffffff",
    },
  };

  return (
    <ColorModeContext.Provider
      value={{
        setMode: setColorMode,
        mode,
      }}
    >
      <ConfigProvider
        theme={mode === "light" ? lightThemeConfig : darkThemeConfig}
      >
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
};
