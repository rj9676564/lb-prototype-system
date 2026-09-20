import React, { useRef, useState } from "react";
import { Segmented, Space, Typography, Card, Button, Progress, Spin, message, Alert } from "antd";
import {
  FolderOpenOutlined,
  FileZipOutlined,
  InboxOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

export interface FileWithRelPath {
  file: File;
  relativePath: string;
}

export interface PrototypeUploadZoneProps {
  onFilesChange?: (data: {
    mode: "folder" | "zip";
    folderFiles: FileWithRelPath[];
    zipFile: File | null;
  }) => void;
  packagingProgress?: number | null; // 0-100 when packaging
  packagingText?: string;
}

// 异步非阻塞遍历拖拽目录树
async function scanDataTransfer(dataTransfer: DataTransfer): Promise<{
  mode: "folder" | "zip";
  folderFiles: FileWithRelPath[];
  zipFile: File | null;
}> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    const files = Array.from(dataTransfer.files || []);
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
      return { mode: "zip", folderFiles: [], zipFile: files[0] };
    }
    const folderFiles = files.map((f) => ({
      file: f,
      relativePath: f.webkitRelativePath || f.name,
    }));
    return { mode: "folder", folderFiles, zipFile: null };
  }

  // 检查是否只拖入了一个 ZIP 文件
  if (items.length === 1) {
    const entry = items[0].webkitGetAsEntry?.();
    if (entry && entry.isFile && entry.name.toLowerCase().endsWith(".zip")) {
      const file = dataTransfer.files[0];
      return { mode: "zip", folderFiles: [], zipFile: file };
    }
  }

  const folderFiles: FileWithRelPath[] = [];

  async function traverseEntry(entry: any, currentPath: string): Promise<void> {
    if (!entry) return;

    if (entry.isFile) {
      return new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            folderFiles.push({
              file,
              relativePath: currentPath ? `${currentPath}/${file.name}` : file.name,
            });
            resolve();
          },
          () => resolve(),
        );
      });
    }

    if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = (): Promise<any[]> =>
        new Promise((resolve) => {
          reader.readEntries(
            (entries: any[]) => resolve(entries || []),
            () => resolve([]),
          );
        });

      while (true) {
        const batch = await readBatch();
        if (batch.length === 0) break;
        const nextPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        for (const child of batch) {
          await traverseEntry(child, nextPath);
        }
      }
    }
  }

  const rootEntries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) {
      rootEntries.push(entry);
    }
  }

  for (const entry of rootEntries) {
    // 如果顶级是一个目录，相对路径不包含最外层目录名，直接以根为准
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = (): Promise<any[]> =>
        new Promise((resolve) => {
          reader.readEntries(
            (entries: any[]) => resolve(entries || []),
            () => resolve([]),
          );
        });

      while (true) {
        const batch = await readBatch();
        if (batch.length === 0) break;
        for (const child of batch) {
          await traverseEntry(child, "");
        }
      }
    } else {
      await traverseEntry(entry, "");
    }
  }

  return { mode: "folder", folderFiles, zipFile: null };
}

export const PrototypeUploadZone: React.FC<PrototypeUploadZoneProps> = ({
  onFilesChange,
  packagingProgress,
  packagingText,
}) => {
  const [uploadMode, setUploadMode] = useState<"folder" | "zip">("folder");
  const [folderFiles, setFolderFiles] = useState<FileWithRelPath[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [folderName, setFolderName] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const notifyChange = (mode: "folder" | "zip", fFiles: FileWithRelPath[], zFile: File | null) => {
    onFilesChange?.({
      mode,
      folderFiles: fFiles,
      zipFile: zFile,
    });
  };

  const handleNativeFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    setIsScanning(true);
    setTimeout(() => {
      const list: FileWithRelPath[] = [];
      let detectedFolderName = "";
      for (let i = 0; i < rawFiles.length; i++) {
        const f = rawFiles[i];
        let rel = f.webkitRelativePath || f.name;
        const parts = rel.split("/");
        if (parts.length > 1) {
          if (!detectedFolderName) detectedFolderName = parts[0];
          rel = parts.slice(1).join("/");
        }
        list.push({ file: f, relativePath: rel });
      }

      setFolderName(detectedFolderName || "原型文件夹");
      setFolderFiles(list);
      setZipFile(null);
      setUploadMode("folder");
      notifyChange("folder", list, null);
      setIsScanning(false);
      message.success(`成功读取文件夹，共 ${list.length} 个文件`);
    }, 20);
  };

  const handleNativeZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;
    const file = rawFiles[0];
    setZipFile(file);
    setFolderFiles([]);
    setUploadMode("zip");
    notifyChange("zip", [], file);
    message.success(`已选择压缩包: ${file.name}`);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isScanning || packagingProgress !== null && packagingProgress !== undefined) return;

    setIsScanning(true);
    try {
      const result = await scanDataTransfer(e.dataTransfer);
      if (result.mode === "zip" && result.zipFile) {
        setUploadMode("zip");
        setZipFile(result.zipFile);
        setFolderFiles([]);
        notifyChange("zip", [], result.zipFile);
        message.success(`已识别并选择压缩包: ${result.zipFile.name}`);
      } else if (result.folderFiles.length > 0) {
        setUploadMode("folder");
        setFolderFiles(result.folderFiles);
        setZipFile(null);
        setFolderName("已拖入的原型文件夹");
        notifyChange("folder", result.folderFiles, null);
        message.success(`已成功识别文件夹，共包含 ${result.folderFiles.length} 个文件`);
      } else {
        message.warning("未检测到有效的文件或文件夹！");
      }
    } catch (err: any) {
      message.error("读取拖入文件失败: " + (err?.message || "未知错误"));
    } finally {
      setIsScanning(false);
    }
  };

  const clearSelection = () => {
    setFolderFiles([]);
    setZipFile(null);
    setFolderName("");
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (zipInputRef.current) zipInputRef.current.value = "";
    notifyChange(uploadMode, [], null);
  };

  const totalFolderSize = folderFiles.reduce((acc, f) => acc + (f.file?.size || 0), 0);
  const totalFolderSizeMB = (totalFolderSize / (1024 * 1024)).toFixed(2);

  const entryHtml = folderFiles.find((f) => {
    const name = f.relativePath.toLowerCase();
    return name === "index.html" || name === "start.html" || name === "app.html";
  })?.relativePath;

  const hasSelection = uploadMode === "folder" ? folderFiles.length > 0 : !!zipFile;

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleNativeFolderChange}
        style={{ display: "none" }}
        // @ts-ignore
        webkitdirectory="true"
        directory="true"
        multiple
      />
      <input
        type="file"
        ref={zipInputRef}
        onChange={handleNativeZipChange}
        accept=".zip,application/zip,application/x-zip-compressed"
        style={{ display: "none" }}
      />

      <Segmented
        value={uploadMode}
        onChange={(val) => {
          const mode = val as "folder" | "zip";
          setUploadMode(mode);
          notifyChange(mode, folderFiles, zipFile);
        }}
        options={[
          { label: "选择整个文件夹 (推荐)", value: "folder", icon: <FolderOpenOutlined /> },
          { label: "上传 ZIP 压缩包", value: "zip", icon: <FileZipOutlined /> },
        ]}
      />

      {isScanning ? (
        <Card style={{ textAlign: "center", padding: "30px 0", background: "#fafafa" }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text strong>正在快速读取文件夹内容，请稍候...</Text>
          </div>
        </Card>
      ) : hasSelection ? (
        <Card
          bordered
          style={{
            background: "#f6ffed",
            borderColor: "#b7eb8f",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space size="middle" align="center">
              <CheckCircleOutlined style={{ fontSize: 28, color: "#52c41a" }} />
              <div>
                <div style={{ fontSize: 16, fontWeight: "bold" }}>
                  {uploadMode === "folder" ? `📁 ${folderName || "原型文件夹"}` : `📦 ${zipFile?.name}`}
                </div>
                <Space style={{ marginTop: 4 }}>
                  {uploadMode === "folder" ? (
                    <>
                      <Text type="secondary">包含文件：{folderFiles.length} 个</Text>
                      <Text type="secondary">|</Text>
                      <Text type="secondary">总大小：约 {totalFolderSizeMB} MB</Text>
                      {entryHtml && (
                        <>
                          <Text type="secondary">|</Text>
                          <Text type="success">入口：{entryHtml}</Text>
                        </>
                      )}
                    </>
                  ) : (
                    <Text type="secondary">
                      大小：约 {((zipFile?.size || 0) / (1024 * 1024)).toFixed(2)} MB
                    </Text>
                  )}
                </Space>
              </div>
            </Space>

            <Space>
              <Button
                onClick={() => {
                  if (uploadMode === "folder") {
                    folderInputRef.current?.click();
                  } else {
                    zipInputRef.current?.click();
                  }
                }}
              >
                重新选择
              </Button>
              <Button danger icon={<DeleteOutlined />} onClick={clearSelection}>
                清除
              </Button>
            </Space>
          </div>
        </Card>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          onClick={() => {
            if (uploadMode === "folder") {
              folderInputRef.current?.click();
            } else {
              zipInputRef.current?.click();
            }
          }}
          style={{
            border: `2px dashed ${isDragging ? "#1677ff" : "#d9d9d9"}`,
            borderRadius: 8,
            padding: "36px 20px",
            textAlign: "center",
            background: isDragging ? "#e6f4ff" : "#fafafa",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <p style={{ fontSize: 44, color: isDragging ? "#1677ff" : "#4096ff", marginBottom: 12 }}>
            <InboxOutlined />
          </p>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>
            {uploadMode === "folder"
              ? "点击选择或将整个 Axure 原型文件夹拖拽至此处"
              : "点击选择或将 ZIP 压缩包拖拽至此处"}
          </div>
          <Text type="secondary">
            {uploadMode === "folder"
              ? "支持拖拽包含大量图片的 Axure 导出目录，瞬间秒读不卡顿"
              : "支持标准的 Axure 原型 .zip 压缩包"}
          </Text>
        </div>
      )}

      {packagingProgress !== null && packagingProgress !== undefined && (
        <Card style={{ background: "#e6f4ff", borderColor: "#91caff" }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Text strong>{packagingText || "正在打包原型文件..."}</Text>
              <Text type="secondary">{packagingProgress}%</Text>
            </div>
            <Progress percent={packagingProgress} status="active" />
          </Space>
        </Card>
      )}

      <Alert
        type="info"
        showIcon
        message="自动归档与 Git 提交"
        description="上传成功后，系统将自动按「当前年月 / 项目名 / 版本标题」归档写入 Git 仓库，并自动执行 Git Commit & Push。"
      />
    </Space>
  );
};
