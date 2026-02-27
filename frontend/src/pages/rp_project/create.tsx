import React from "react";
import { Create, useForm } from "@refinedev/antd";
import { Form, Input, Upload, Button } from "antd";
import { UploadOutlined } from "@ant-design/icons";

export const ProjectCreate = () => {
  const { formProps, saveButtonProps } = useForm<any>();

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
    <Create saveButtonProps={saveButtonProps}>
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
          label="封面图片"
          valuePropName="fileList"
          getValueFromEvent={getValueFromEvent}
          name="cover"
        >
          <Upload
            beforeUpload={() => false}
            maxCount={1}
            listType="picture"
            accept="image/*"
          >
            <Button icon={<UploadOutlined />}>点击上传封面</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Create>
  );
};
