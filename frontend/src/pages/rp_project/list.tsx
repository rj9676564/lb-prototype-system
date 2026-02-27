import React from "react";
import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
  DateField,
} from "@refinedev/antd";
import { Table, Space, Avatar, Button, Form, Input } from "antd";
import { EyeOutlined, SearchOutlined } from "@ant-design/icons";
import { useMany, useGetIdentity } from "@refinedev/core";
import { useNavigate } from "react-router";
import { API_URL } from "../../providers/constants";

export const ProjectList = () => {
  const { data: user } = useGetIdentity<any>();
  const navigate = useNavigate();

  const { tableProps, searchFormProps } = useTable({
    syncWithLocation: true,
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

  const { query: userQuery } = useMany({
    resource: "users",
    ids: tableProps?.dataSource?.map((item: any) => item?.creator).filter(Boolean) ?? [],
    queryOptions: {
      enabled: !!tableProps?.dataSource,
    },
  });
  const userData = userQuery.data;
  const userIsLoading = userQuery.isLoading;

  return (
    <List>
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: "1rem" }}>
        <Form.Item name="keyword">
          <Input placeholder="检索资源 项目名称/创建人邮箱" prefix={<SearchOutlined />} style={{ width: 300 }} />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          搜索
        </Button>
      </Form>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="cover"
          title="封面"
          render={(value, record: any) =>
            value ? (
              <Avatar
                src={`${API_URL}/files/rp_project/${record.id}/${value}`}
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
                <Button 
                  icon={<EyeOutlined />} 
                  size="small" 
                  onClick={() => navigate(`/rp_prototype?filters[0][field]=project&filters[0][operator]=eq&filters[0][value]=${record.id}`)}
                >
                  查看版本
                </Button>
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
    </List>
  );
};
