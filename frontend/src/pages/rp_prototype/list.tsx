import React from "react";
import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
  DateField,
  useSelect,
  CreateButton,
} from "@refinedev/antd";
import { Table, Space, Tag, Button, Tooltip, Form, Select, Drawer } from "antd";
import { GlobalOutlined, SearchOutlined, ExportOutlined } from "@ant-design/icons";
import { useMany, useGetIdentity } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";
import { BASE_URL } from "../../providers/constants";

export const PrototypeList = () => {
  const { data: user } = useGetIdentity<any>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 预览相关的状态
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [drawerTitle, setDrawerTitle] = React.useState<string>("");

  const { tableProps, filters, searchFormProps } = useTable({
    syncWithLocation: true,
    onSearch: (values: any) => {
      return [
        {
          field: "project",
          operator: "eq",
          value: values.project,
        },
      ];
    },
    sorters: {
      initial: [
        {
          field: "created",
          order: "desc",
        },
      ],
    },
  });

  const { selectProps: projectSelectProps } = useSelect({
    resource: "rp_project",
    optionLabel: "name",
    optionValue: "id",
  });

  const { query } = useMany({
    resource: "rp_project",
    ids: tableProps?.dataSource?.map((item: any) => item?.project).filter(Boolean) ?? [],
    queryOptions: {
      enabled: !!tableProps?.dataSource,
    },
  });
  const projectData = query.data;
  const projectIsLoading = query.isLoading;

  const { query: userQuery } = useMany({
    resource: "users",
    ids: tableProps?.dataSource?.map((item: any) => item?.creator).filter(Boolean) ?? [],
    queryOptions: {
      enabled: !!tableProps?.dataSource,
    },
  });
  const userData = userQuery.data;
  const userIsLoading = userQuery.isLoading;

  const projectFilter = filters?.find((f: any) => f.field === "project" && f.operator === "eq");
  // 优先从 URL 的 project 参数获取，其次从 filters，最后尝试解析 filters[0][value] 这种原始 URL 结构
  const filteredProjectId = searchParams.get("project") || 
                         (projectFilter as any)?.value || 
                         searchParams.get("filters[0][value]");

  return (
    <List 
      headerButtons={
        <CreateButton 
          resource="rp_prototype" 
          onClick={() => {
            const url = `/rp_prototype/create${filteredProjectId ? `?project=${filteredProjectId}` : ""}`;
            navigate(url);
          }}
        />
      }
    >
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: "1rem" }}>
        <Form.Item name="project" label="筛选项目">
          <Select
            {...projectSelectProps}
            placeholder="全部项目"
            allowClear
            style={{ width: 200 }}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
          查询
        </Button>
      </Form>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="title" title="版本标题" />
        
        <Table.Column
          dataIndex="status"
          title="状态"
          render={(value) => {
            const statusMap: Record<string, { label: string; color: string }> = {
              draft: { label: "草稿", color: "default" },
              reviewing: { label: "审核中", color: "blue" },
              approved: { label: "已通过", color: "success" },
              rejected: { label: "已拒绝", color: "error" },
            };
            const status = statusMap[value] || { label: value, color: "default" };
            return <Tag color={status.color}>{status.label}</Tag>;
          }}
        />
        <Table.Column
          dataIndex={["project"]}
          title="所属项目"
          render={(value) => {
            if (projectIsLoading) return "加载中...";
            return projectData?.data?.find((item: any) => item.id === value)?.name ?? value;
          }}
        />
        <Table.Column dataIndex="remark" title="备注" />
        <Table.Column
          dataIndex="creator"
          title="创建人"
          render={(value) => {
            if (userIsLoading) return "加载中...";
            return userData?.data?.find((item: any) => item.id === value)?.email || value || "-";
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
            return (
              <Space>
                {record.url && (
                  <Tooltip title="预览原型">
                    <Button
                      size="small"
                      icon={<GlobalOutlined />}
                      onClick={() => {
                        const fullUrl = record.url.startsWith('/') 
                          ? `${BASE_URL}${record.url}` 
                          : record.url;
                        setPreviewUrl(fullUrl);
                        setDrawerTitle(record.title);
                      }}
                    />
                  </Tooltip>
                )}
                <ShowButton hideText size="small" recordItemId={record.id} />
                {isCreator && (
                  <>
                    <EditButton hideText size="small" recordItemId={record.id} />
                    <DeleteButton hideText size="small" recordItemId={record.id} />
                  </>
                )}
              </Space>
            );
          }}
        />
      </Table>

      {/* 侧边预览抽屉 */}
      <Drawer
        title={drawerTitle}
        placement="right"
        width="80%"
        onClose={() => setPreviewUrl(null)}
        open={!!previewUrl}
        extra={
          <Button 
            icon={<ExportOutlined />} 
            onClick={() => window.open(previewUrl!, "_blank")}
          >
            新窗口打开
          </Button>
        }
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            title="Prototype Preview"
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        )}
      </Drawer>
    </List>
  );
};
