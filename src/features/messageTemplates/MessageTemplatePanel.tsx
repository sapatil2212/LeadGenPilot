/**
 * Top-level WhatsApp template panel: switches between the library and the
 * builder. Owns the "which view" state so App.tsx only needs to mount one
 * component for the WhatsApp templates experience.
 */

import React, { useState } from "react";
import type { Themed } from "../../ui/primitives";
import MessageTemplateLibrary from "./MessageTemplateLibrary";
import MessageTemplateBuilder from "./MessageTemplateBuilder";
import type { MessageTemplateView, MessageTemplatePayload, TemplateCategory } from "./api";

interface Props extends Themed {
  businessName?: string;
}

type View =
  | { mode: "library" }
  | { mode: "builder"; template: MessageTemplateView | null; seed?: { name: string; category: TemplateCategory; payload: MessageTemplatePayload } | null };

export default function MessageTemplatePanel({ isLight, businessName }: Props) {
  const [view, setView] = useState<View>({ mode: "library" });

  if (view.mode === "builder") {
    return (
      <MessageTemplateBuilder
        isLight={isLight}
        businessName={businessName}
        template={view.template}
        seed={view.seed}
        onBack={() => setView({ mode: "library" })}
        onSaved={() => setView({ mode: "library" })}
      />
    );
  }

  return (
    <MessageTemplateLibrary
      isLight={isLight}
      businessName={businessName}
      onOpen={({ template, seed }) => setView({ mode: "builder", template, seed })}
    />
  );
}
