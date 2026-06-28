import * as React from "react";

import Markdown from "~/components/markdown/markdown";

interface TextPartProps {
  text: string;
  isAnimating?: boolean;
  onClickCitation?: (id: string) => void;
  citationOrdinalMap?: Map<string, number>;
}

// memo:MessageParts 重渲染时,未变更的文本块跳过 reconciliation,避免重建 <Markdown>
// 元素树。流式输出时只有正在生成的那条消息进 Markdown,其余文本块稳定不动。
export const TextPart = React.memo(function TextPart({
  text,
  isAnimating,
  onClickCitation,
  citationOrdinalMap,
}: TextPartProps) {
  if (!text) return null;
  return (
    <div data-part="text">
      <Markdown
        content={text}
        className="message-markdown"
        isAnimating={isAnimating}
        onClickCitation={onClickCitation}
        citationOrdinalMap={citationOrdinalMap}
      />
    </div>
  );
});
