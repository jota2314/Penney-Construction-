"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";

function BottomSheet({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="bottom-sheet" {...props} />;
}

function BottomSheetTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="bottom-sheet-trigger" {...props} />;
}

function BottomSheetClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="bottom-sheet-close" {...props} />;
}

function BottomSheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="bottom-sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60",
        className
      )}
      {...props}
    />
  );
}

interface BottomSheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  showCloseButton?: boolean;
  /** Max height of the sheet on mobile. Default: 90vh */
  maxHeight?: string;
}

function BottomSheetContent({
  className,
  children,
  showCloseButton = true,
  maxHeight = "90vh",
  ...props
}: BottomSheetContentProps) {
  // When the phone keyboard is open, iOS pans the layout viewport and drags
  // this fixed sheet up with it — a 90vh sheet ends up under the status bar.
  // Clamp the sheet to what's actually visible, and lift its bottom edge
  // above the keyboard (the sheet is anchored to the layout viewport's
  // bottom, which sits behind the keyboard) so the footer stays reachable.
  const { inset: keyboardInset, height: visibleHeight, bottomGap } =
    useKeyboardInset();
  const effectiveMaxHeight =
    keyboardInset > 0 && visibleHeight > 0 ? `${visibleHeight - 8}px` : maxHeight;
  return (
    <DialogPrimitive.Portal>
      <BottomSheetOverlay />
      <DialogPrimitive.Content
        data-slot="bottom-sheet-content"
        style={
          {
            maxHeight: effectiveMaxHeight,
            "--keyboard-gap": `${bottomGap}px`,
          } as React.CSSProperties
        }
        className={cn(
          "bg-background fixed z-50 flex flex-col shadow-2xl outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:duration-200 data-[state=open]:duration-300",
          // Mobile: bottom sheet, lifted above the keyboard when it's open
          "inset-x-0 bottom-[var(--keyboard-gap,0px)] rounded-t-2xl border-t",
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          // Desktop: right-side panel
          "md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:top-0",
          "md:h-full md:w-full md:max-w-md md:rounded-none md:border-t-0 md:border-l",
          "md:!max-h-none",
          "md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right",
          className
        )}
        {...props}
      >
        {/* Drag handle (mobile only) */}
        <div className="md:hidden flex justify-center pt-2 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {children}

        {showCloseButton && (
          <DialogPrimitive.Close className="absolute top-3 right-3 rounded-md p-1 opacity-60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring transition-opacity">
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function BottomSheetHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bottom-sheet-header"
      className={cn("px-4 pt-2 pb-3 border-b shrink-0", className)}
      {...props}
    />
  );
}

function BottomSheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="bottom-sheet-title"
      className={cn("text-base font-semibold pr-8", className)}
      {...props}
    />
  );
}

function BottomSheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="bottom-sheet-description"
      className={cn("text-xs text-muted-foreground mt-0.5", className)}
      {...props}
    />
  );
}

function BottomSheetBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bottom-sheet-body"
      className={cn("flex-1 overflow-y-auto px-4 py-3 min-h-0", className)}
      {...props}
    />
  );
}

function BottomSheetFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bottom-sheet-footer"
      className={cn(
        "px-4 py-3 border-t shrink-0 flex flex-col gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className
      )}
      {...props}
    />
  );
}

export {
  BottomSheet,
  BottomSheetTrigger,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetDescription,
  BottomSheetBody,
  BottomSheetFooter,
};
