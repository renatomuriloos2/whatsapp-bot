import Image from "next/image";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-6",
  md: "h-8",
  lg: "h-12",
} as const;

export function Logo({
  className,
  size = "md",
}: {
  className?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <Image
      src="/brand/rethink-logo-wordmark-blanco.png"
      alt="Rethink — Chemistry by Design"
      width={900}
      height={224}
      priority
      className={cn(SIZES[size], "w-auto", className)}
    />
  );
}
