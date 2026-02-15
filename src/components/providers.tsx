"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <TooltipProvider>
        {children}
      </TooltipProvider>
    </LanguageProvider>
  );
}
