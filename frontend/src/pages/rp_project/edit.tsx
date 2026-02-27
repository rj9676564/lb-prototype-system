import React from "react";
import { Edit, useForm } from "@refinedev/antd";
import { Form, Input, Upload, Button } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { API_URL } from "../../providers/constants";

export const ProjectEdit = () => {
  const { formProps, saveButtonProps, query } = useForm<any>();
  const projectData = query?.data?.data;

  const handleOnFinish = (values: any) => {
    const formData = new FormData();
    Object.keys(values).forEach((key) => {
      if (key === "cover") {
        if (values.cover?.[0]?.originFileObj) {
          formData.append("cover", values.cover[0].originFileObj);
        }
      } else if (values[key] !== undefined && values[key] !== null) {
        formData.append(key, values[key]);
      }
    });

    if (formProps.onFinish) {
      formProps.onFinish(formData as any);
    }
  };

  const getValueFromEvent = (e: any) => {
    if (Array.isArray(e)) {
      return e;
    }
    return e?.fileList || [];
  };

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} onFinish={handleOnFinish} layout="vertical">
        <Form.Item
          label="项目名称"
          name={["name"]}
          rules={[{ required: true, message: "请输入项目名称！" }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          label="项目描述"
          name={["description"]}
        >
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item
          label="封面图片 (不上传则保持原样)"
          name="cover"
          getValueFromEvent={getValueFromEvent}
          getValueProps={(value) => {
            if (!value) return { fileList: [] };
            if (typeof value === "string") {
              return {
                fileList: [
                  {
                    uid: "-1",
                    name: value,
                    status: "done",
                    url: `${API_URL}/files/rp_project/${projectData?.id}/${value}`,
                  },
                ],
              };
            }
            return { fileList: value };
          }}
        >
          <Upload
            beforeUpload={() => false}
            maxCount={1}
            listType="picture"
            accept="image/*"
          >
            <Button icon={<UploadOutlined />}>点击上传新封面</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Edit>
  );
};
