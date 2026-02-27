import { AuthProvider } from "@refinedev/core";
import { pb } from "../lib/pocketbase";

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    try {
      let authData;
      try {
        // 尝试普通用户登录
        authData = await pb.collection("users").authWithPassword(email, password);
      } catch (e) {
        try {
          // 尝试新版 PocketBase (v0.23+) 超级管理员登录
          authData = await pb.collection("_superusers").authWithPassword(email, password);
        } catch (e2) {
          // 尝试旧版 PocketBase (v0.22 及以下) 原则理员登录
          authData = await pb.admins.authWithPassword(email, password);
        }
      }
      
      if (authData && authData.token) {
        return { success: true, redirectTo: "/rp_project" };
      }
    } catch (error: any) {
      return { success: false, error: { name: "LoginError", message: "账号或密码错误" } };
    }
    return { success: false, error: { name: "LoginError", message: "登录失败" } };
  },
  logout: async () => {
    pb.authStore.clear();
    return { success: true, redirectTo: "/login" };
  },
  check: async () => {
    if (pb.authStore.isValid) {
      return { authenticated: true };
    }
    return { authenticated: false, redirectTo: "/login" };
  },
  getPermissions: async () => null,
  getIdentity: async () => {
    if (pb.authStore.model) {
      const user = pb.authStore.model;
      return {
        ...user,
        name: user.username || user.email,
        avatar: user.avatar?.url || undefined,
      };
    }
    return null;
  },
  onError: async (error) => {
    return { error };
  },
};
