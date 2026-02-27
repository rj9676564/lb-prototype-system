import React from "react";
import { useShow } from "@refinedev/core";
import { Show, TextField, DateField } from "@refinedev/antd";
import { Typography, Image } from "antd";
import { API_URL } from "../../providers/constants";

const { Title, Text } = Typography;

export const ProjectShow = () => {
  const { query } = useShow({});
  const { data, isLoading } = query;

  const record = data?.data;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>ID</Title>
      <TextField value={record?.id} />
      <Title level={5}>封面</Title>
      {record?.cover ? (
        <Image
          src={`${API_URL}/files/rp_project/${record?.id}/${record?.cover}`}
          width={200}
        />
      ) : (
        <Text>暂无封面</Text>
      )}
      <Title level={5}>名称</Title>
      <TextField value={record?.name} />
      <Title level={5}>描述</Title>
      <TextField value={record?.description} />
      <Title level={5}>创建时间</Title>
      <DateField format="YYYY-MM-DD HH:mm:ss" value={record?.created} />
    </Show>
  );
};
