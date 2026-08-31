import React from "react";
import {
  List,
  useTable,
  EditButton,
  DeleteButton,
  DateField,
} from "@refinedev/antd";
import { Table, Space, Avatar, Button, Form, Input, message, Tooltip, Drawer, Flex, Modal } from "antd";
import { EyeOutlined, SearchOutlined, SyncOutlined, GlobalOutlined, ExportOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { useNavigate } from "react-router";
import { pb } from "../../lib/pocketbase";
import { API_URL, BASE_URL } from "../../providers/constants";

type LatestPrototypeMeta = {
  title?: string;
  url?: string;
  updated?: string;
};

export const ProjectList = () => {
  const { data: user } = useGetIdentity<any>();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [syncing, setSyncing] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [drawerTitle, setDrawerTitle] = React.useState<string>("");
  const [latestPrototypeMap, setLatestPrototypeMap] = React.useState<Record<string, LatestPrototypeMeta>>({});

  const { tableProps, searchFormProps, tableQuery } = useTable({
    syncWithLocation: true,
    pagination: {
      pageSize: 50,
    },
    sorters: {
      initial: [
        {
          field: "created",
          order: "desc",
        },
      ],
    },
    onSearch: (values: any) => {
      return [
        {
          field: "q",
          operator: "contains",
          value: values.keyword,
        },
      ];
    },
  });

  const projectIdsKey = (tableProps?.dataSource?.map((item: any) => item?.id).filter(Boolean) ?? []).join(",");

  React.useEffect(() => {
    const projectIds = projectIdsKey ? projectIdsKey.split(",") : [];

    if (projectIds.length === 0) {
      setLatestPrototypeMap({});
      return;
    }

    let cancelled = false;

    const loadLatestPrototypes = async () => {
      try {
        const filter = projectIds.map((id) => `project = "${id}"`).join(" || ");
        const response = await pb.collection("rp_prototype").getList<any>(1, 200, {
          filter,
          sort: "-created",
        });

        if (cancelled) return;

        const map: Record<string, LatestPrototypeMeta> = {};
        for (const item of response.items || []) {
          if (item.project && !map[item.project]) {
            map[item.project] = {
              title: item.title,
              url: item.url,
              updated: item.updated,
            };
          }
        }

        setLatestPrototypeMap(map);
      } catch {
        if (!cancelled) {
          setLatestPrototypeMap({});
        }
      }
    };

    loadLatestPrototypes();

    return () => {
      cancelled = true;
    };
  }, [projectIdsKey]);

  const handleScanImport = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`${API_URL}/prototype-sync/scan`, {
        method: "POST",
        headers: {
          Authorization: pb.authStore.token ? `Bearer ${pb.authStore.token}` : "",
        },
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.message || result?.data?.message || "扫描导入失败");
      }

      const skippedPaths: string[] = Array.isArray(result.skipped_paths) ? result.skipped_paths : [];
      const skippedCount = skippedPaths.length;

      const scannedCount = result.scanned_projects ?? 0;
      const syncedCount = result.synced_projects ?? 0;
      const unsyncedCount = Math.max(scannedCount - syncedCount, skippedCount);

      await messageApi.success(
        `扫描完成：发现 ${scannedCount} 个候选项目，成功同步 ${syncedCount} 个（新增 ${result.created_projects ?? 0}，更新 ${result.updated_projects ?? 0}），未同步 ${unsyncedCount} 个。`,
      );

      if (skippedCount > 0) {
        Modal.warning({
          title: "部分项目导入失败",
          width: 760,
          content: (
            <div style={{ maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {skippedPaths.join("\n")}
            </div>
          ),
        });
      }

      searchFormProps.form?.resetFields();
      await tableQuery.refetch();
    } catch (error: any) {
      messageApi.error(error?.message || "扫描导入失败");
    } finally {
      setSyncing(false);
    }
  };

  const openPreview = (url: string, title: string, updated?: string) => {
    const fullUrl = url.startsWith("/") ? `${BASE_URL}${url}` : url;
    const separator = fullUrl.includes("?") ? "&" : "?";
    const version = updated ? encodeURIComponent(updated) : new Date().getTime().toString();
    const busterUrl = `${fullUrl}${separator}v=${version}`;
    setPreviewUrl(busterUrl);
    setDrawerTitle(title);
  };

  return (
    <List>
      {contextHolder}
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: "1rem" }}>
        <Form.Item name="keyword">
          <Input placeholder="检索项目名称/项目描述/创建人邮箱" prefix={<SearchOutlined />} style={{ width: 300 }} />
        </Form.Item>
        <Flex gap="small">
          <Button type="primary" htmlType="submit">
            搜索
          </Button>
          <Button icon={<SyncOutlined />} loading={syncing} onClick={handleScanImport}>
            扫描导入
          </Button>
        </Flex>
      </Form>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="cover"
          title="封面"
          render={(value, record: any) =>
            value && typeof value === "string" && !value.toLowerCase().endsWith(".svg") ? (
              <Avatar
                src={`${API_URL}/files/rp_project/${record.id}/${value}?thumb=160x160`}
                shape="square"
                size={80}
              />
            ) : null
          }
        />
        <Table.Column dataIndex="name" title="项目名称" />
        <Table.Column dataIndex="description" title="项目描述" />
        <Table.Column
          dataIndex="creator"
          title="创建人"
          render={(value, record: any) => {
            return record?.expand?.creator?.email || record?.expand?.creator?.name || value || "-";
          }}
        />
        <Table.Column
          dataIndex="created"
          title="创建时间"
          render={(value) => <DateField format="YYYY-MM-DD HH:mm:ss" value={value} />}
        />
        <Table.Column
          title="操作"
          dataIndex="actions"
          render={(_, record: any) => {
            const isCreator = user?.id === record.creator;
            const latestPrototype = latestPrototypeMap[record.id];
            return (
              <Space>
                {latestPrototype?.url && (
                  <Tooltip title="预览最新版本">
                    <Button
                      type="primary"
                      icon={<GlobalOutlined />}
                      onClick={() => {
                        openPreview(
                          latestPrototype.url!,
                          `${record.name} - ${latestPrototype.title || "最新版本"}`,
                          latestPrototype.updated,
                        );
                      }}
                    >
                      预览最新
                    </Button>
                  </Tooltip>
                )}
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => navigate(`/rp_prototype?filters[0][field]=project&filters[0][operator]=eq&filters[0][value]=${record.id}`)}
                >
                  查看版本
                </Button>
                {isCreator && (
                  <>
                    <EditButton hideText recordItemId={record.id} />
                    <DeleteButton hideText recordItemId={record.id} />
                  </>
                )}
              </Space>
            );
          }}
        />
      </Table>

      <Drawer
        title={drawerTitle}
        placement="right"
        width="80%"
        onClose={() => setPreviewUrl(null)}
        open={!!previewUrl}
        extra={
          <Button
            icon={<ExportOutlined />}
            onClick={() => previewUrl && window.open(previewUrl, "_blank")}
          >
            新窗口打开
          </Button>
        }
        styles={{ body: { padding: 0, overflow: "hidden" } }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            title="Latest Prototype Preview"
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        )}
      </Drawer>
    </List>
  );
};
