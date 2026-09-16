import { Refine, WelcomePage, Authenticated, useGetIdentity } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import { ThemedLayout, ThemedSider, AuthPage, ErrorComponent, ThemedTitle } from "@refinedev/antd";
import { 
  ProjectList, ProjectCreate, ProjectEdit, ProjectShow 
} from "./pages/rp_project";
import { 
  PrototypeList, PrototypeCreate, PrototypeEdit, PrototypeShow 
} from "./pages/rp_prototype";
import { Header } from "./components/header";

import { useNotificationProvider } from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import routerProvider, {
  DocumentTitleHandler,
  UnsavedChangesNotifier,
  CatchAllNavigate,
  NavigateToResource,
} from "@refinedev/react-router";
import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter, Route, Routes, Outlet, Navigate } from "react-router";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { dataProvider } from "./providers/data";
import { authProvider } from "./providers/authProvider";

const translations: Record<string, string> = {
  // 通用按钮
  "buttons.save": "保存",
  "buttons.cancel": "取消",
  "buttons.edit": "编辑",
  "buttons.delete": "删除",
  "buttons.create": "新建",
  "buttons.show": "查看",
  "buttons.add": "添加",
  "buttons.filter": "筛选",
  "buttons.clear": "清空",
  "buttons.refresh": "刷新",
  "buttons.logout": "退出登录",

  // 通用操作
  "actions.edit": "编辑",
  "actions.save": "保存",
  "actions.delete": "删除",
  "actions.create": "新建",
  "actions.show": "查看",

  // 通知
  "notifications.success": "操作成功",
  "notifications.error": "操作失败",
  "notifications.createSuccess": "创建成功",
  "notifications.editSuccess": "保存成功",
  "notifications.deleteSuccess": "删除成功",

  // 登录页 (Refine AuthPage)
  "pages.login.title": "登录",
  "pages.login.signin": "登录",
  "pages.login.fields.email": "邮箱地址",
  "pages.login.fields.password": "密码",
  "pages.login.buttons.forgotPassword": "忘记密码？",
  "pages.login.buttons.rememberMe": "记住我",
  "pages.login.buttons.noAccount": "没有账号？",
  "pages.login.signup": "立即注册",
  "pages.login.divider": "或",
  "pages.login.errors.requiredEmail": "请输入邮箱地址",
  "pages.login.errors.validEmail": "请输入有效的邮箱格式",
  "pages.login.errors.requiredPassword": "请输入密码",

  // 注册页 (备用)
  "pages.register.title": "注册账号",
  "pages.register.buttons.submit": "注册",
  "pages.register.buttons.haveAccount": "已有账号？",
  "pages.register.signin": "去登录",
  "pages.register.errors.requiredEmail": "请输入邮箱地址",
  "pages.register.errors.validEmail": "请输入有效的邮箱格式",
  "pages.register.errors.requiredPassword": "请输入密码",

  // 找回密码页 (备用)
  "pages.forgotPassword.title": "找回密码",
  "pages.forgotPassword.buttons.submit": "发送重置链接",
  "pages.forgotPassword.fields.email": "邮箱地址",
  "pages.forgotPassword.buttons.haveAccount": "想起来了？",

  // 框架通用
  "warnWhenUnsavedChanges": "您的更改尚未保存，确定要离开吗？",
  "loading": "加载中...",
  "noData": "暂无数据",
  "table.actions": "操作",

  // 资源列表标题
  "rp_project.titles.list": "项目列表",
  "rp_project.titles.show": "项目详情",
  "rp_project.titles.edit": "编辑项目",
  "rp_project.titles.create": "新建项目",
  "rp_prototype.titles.list": "版本列表",
  "rp_prototype.titles.show": "版本详情",
  "rp_prototype.titles.edit": "编辑版本",
  "rp_prototype.titles.create": "新建版本",
};

const i18nProvider = {
  translate: (key: string, _options?: any, defaultMessage?: string) => {
    return translations[key] || defaultMessage || key;
  },
  changeLocale: (_lang: string) => Promise.resolve(),
  getLocale: () => "zh",
};

const CustomSider: React.FC<any> = (props) => {
  const { data: user } = useGetIdentity<any>();
  return (
    <ThemedSider
      {...props}
      render={({ items, logout }) => (
        <>
          {items}
          {user && logout}
        </>
      )}
    />
  );
};

function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>

        <RefineKbarProvider>
          <ColorModeContextProvider>
            <AntdApp>
              <DevtoolsProvider>
                <Refine
                  dataProvider={dataProvider}
                  authProvider={authProvider}
                  notificationProvider={useNotificationProvider}
                  routerProvider={routerProvider}
                  i18nProvider={i18nProvider}
                  options={{
                    syncWithLocation: true,
                    warnWhenUnsavedChanges: true,
                    projectId: "amqAdV-ZbIs6S-5FzDUd",
                    reactQuery: {
                      clientConfig: {
                        defaultOptions: {
                          queries: {
                            staleTime: 1000 * 5,
                            refetchOnWindowFocus: false,
                          },
                        },
                      },
                    },
                  }}
                  resources={[
                    {
                      name: "rp_project",
                      list: "/rp_project",
                      create: "/rp_project/create",
                      edit: "/rp_project/edit/:id",
                      show: "/rp_project/show/:id",
                      meta: {
                        canDelete: true,
                        label: "项目管理",
                      },
                    },
                    {
                      name: "rp_prototype",
                      list: "/rp_prototype",
                      create: "/rp_prototype/create",
                      edit: "/rp_prototype/edit/:id",
                      show: "/rp_prototype/show/:id",
                      meta: {
                        canDelete: true,
                        label: "版本管理",
                      },
                    },
                  ]}
                >
                  <Routes>
                    <Route
                      element={
                        <ThemedLayout
                          Header={Header}
                          Sider={CustomSider}
                          Title={({ collapsed }) => (
                            <ThemedTitle
                              collapsed={collapsed}
                              text="原型管理"
                            />
                          )}
                        >
                          <Outlet />
                        </ThemedLayout>
                      }
                    >
                      <Route index element={<Navigate to="/rp_project" />} />
                      <Route path="/rp_project">
                        <Route index element={<ProjectList />} />
                        <Route
                          path="create"
                          element={
                            <Authenticated key="rp_project-create" fallback={<CatchAllNavigate to="/login" />}>
                              <ProjectCreate />
                            </Authenticated>
                          }
                        />
                        <Route
                          path="edit/:id"
                          element={
                            <Authenticated key="rp_project-edit" fallback={<CatchAllNavigate to="/login" />}>
                              <ProjectEdit />
                            </Authenticated>
                          }
                        />
                        <Route path="show/:id" element={<ProjectShow />} />
                      </Route>
                      <Route path="/rp_prototype">
                        <Route index element={<PrototypeList />} />
                        <Route
                          path="create"
                          element={
                            <Authenticated key="rp_prototype-create" fallback={<CatchAllNavigate to="/login" />}>
                              <PrototypeCreate />
                            </Authenticated>
                          }
                        />
                        <Route
                          path="edit/:id"
                          element={
                            <Authenticated key="rp_prototype-edit" fallback={<CatchAllNavigate to="/login" />}>
                              <PrototypeEdit />
                            </Authenticated>
                          }
                        />
                        <Route path="show/:id" element={<PrototypeShow />} />
                      </Route>
                      <Route path="*" element={<ErrorComponent />} />
                    </Route>
                    <Route
                      element={
                        <Authenticated key="authenticated-auth" fallback={<Outlet />}>
                          <NavigateToResource />
                        </Authenticated>
                      }
                    >
                      <Route
                        path="/login"
                        element={
                          <AuthPage
                            type="login"
                            forgotPasswordLink={false}
                            registerLink={false}
                            title={
                              <ThemedTitle
                                collapsed={false}
                                text="原型管理"
                              />
                            }
                          />
                        }
                      />
                    </Route>
                  </Routes>
                  <RefineKbar />
                  <UnsavedChangesNotifier />
                  <DocumentTitleHandler handler={(options) => options.resource?.name === "rp_project" ? "项目管理 - 原型管理" : options.resource?.name === "rp_prototype" ? "版本管理 - 原型管理" : "原型管理"} />
                </Refine>
                <DevtoolsPanel />
              </DevtoolsProvider>
            </AntdApp>
          </ColorModeContextProvider>
        </RefineKbarProvider>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
