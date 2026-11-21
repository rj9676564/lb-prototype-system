import React, { useState } from "react";
import { Image } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import "./markdown.css";

/** Renders GFM markdown (sanitized raw HTML allowed); click an image to preview it. */
export const MarkdownView: React.FC<{ content?: string }> = ({ content }) => {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  return (
    <>
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeSanitize]}
          components={{
            img: ({ node, ...props }) => (
              <img
                {...props}
                style={{ cursor: "zoom-in" }}
                title="点击预览大图"
                onClick={() => typeof props.src === "string" && setPreviewSrc(props.src)}
              />
            ),
            table: ({ node, ...props }) => (
              <div className="md-table-wrap">
                <table {...props} />
              </div>
            ),
          }}
        >
          {content || ""}
        </ReactMarkdown>
      </div>
      <Image
        style={{ display: "none" }}
        src={previewSrc || undefined}
        preview={{
          visible: !!previewSrc,
          src: previewSrc || undefined,
          onVisibleChange: (v) => {
            if (!v) setPreviewSrc(null);
          },
        }}
      />
    </>
  );
};
