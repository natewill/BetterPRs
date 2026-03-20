import ReactMarkdown from "react-markdown";

type MarkdownProps = {
  content: string;
};

export function Markdown({ content }: MarkdownProps) {
  return (
    <div className="prose-custom">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
