import type { Metadata } from "next";
import { Editor } from "@/customer/studio/editor/Editor";

export const metadata: Metadata = {
  title: "Your stub · TicketStub",
};

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor id={decodeURIComponent(id)} />;
}
