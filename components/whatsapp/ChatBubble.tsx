import { cn } from "@/lib/utils";

export function ChatBubble({
  outgoing,
  author,
  time,
  status,
  children,
}: {
  outgoing: boolean;
  author?: string;
  time?: string;
  status?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
          outgoing
            ? "rounded-br-sm bg-rethink-orange/15 text-rethink-cream"
            : "rounded-bl-sm bg-surface/10 text-rethink-cream"
        )}
      >
        {author && <p className="mb-0.5 text-[11px] font-medium text-rethink-cream/50">{author}</p>}
        {children}
        {(time || status) && (
          <p className="mt-1 text-right text-[10px] text-rethink-cream/40">
            {time}
            {status ? ` · ${status}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
