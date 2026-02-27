import React from "react";
import { Edit, useForm, useSelect } from "@refinedev/antd";
import { Form, Input, Select, Upload, Button } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { API_URL } from "../../providers/constants";

export const PrototypeEdit = () => {
  const { formProps, saveButtonProps, query } = useForm<any>();
  const prototypeData = query?.data?.data;

  const handleOnFinish = (values: any) => {
    const formData = new FormData();
    Object.keys(values).forEach((key) => {
      if (key === "file") {
        if (values.file?.[0]?.originFileObj) {
          formData.append("file", values.file[0].originFileObj);
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

  const { selectProps: projectSelectProps } = useSelect({
    resource: "rp_project",
    optionLabel: "name",
    optionValue: "id",
    defaultValue: query?.data?.data?.field,
  });

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} onFinish={handleOnFinish} layout="vertical">
        <Form.Item
          label="所属项目"
          name={["project"]}
          rules={[{ required: true, message: "请选择所属项目！" }]}
        >
          <Select {...projectSelectProps} placeholder="选择项目" />
        </Form.Item>
        <Form.Item
          label="版本标题"
          name={["title"]}
          rules={[{ required: true, message: "请输入版本标题！" }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          label="备注"
          name={["remark"]}
        >
          <Input.TextArea rows={2} placeholder="输入版本备注信息" />
        </Form.Item>
        <Form.Item
          label="原型压缩包 (不上传则保持原样)"
          name="file"
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
                    url: `${API_URL}/files/rp_prototype/${prototypeData?.id}/${value}`,
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
            accept=".zip,application/zip,application/x-zip-compressed"
          >
            <Button icon={<UploadOutlined />}>上传新压缩包</Button>
          </Upload>
        </Form.Item>
        <Form.Item
          label="状态"
          name={["status"]}
        >
          <Select
            options={[
              { label: "草稿", value: "draft" },
              { label: "审核中", value: "reviewing" },
              { label: "已通过", value: "approved" },
              { label: "已拒绝", value: "rejected" },
            ]}
          />
        </Form.Item>
      </Form>
    </Edit>
  );
};
