import { permanentRedirect } from "next/navigation";

// The desk map now lives at the top of Help.
export default function MapPage() {
  permanentRedirect("/help");
}
