const runtimeDefaultBaseUrl =
  "http://" + (typeof window !== "undefined" ? window.location.hostname : "127.0.0.1") + ":9000";

const envBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL?.trim();

export const BASE_URL = (envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : runtimeDefaultBaseUrl).replace(/\/+$/, "");
export const API_URL = `${BASE_URL}/api`;
