import "./globals.css";
import { NodeProvider } from "../lib/store";
import Shell from "../components/Shell";

export const metadata = {
  title: "Peerloom — serverless peer-to-peer chat & file sharing",
  description: "Direct TCP chat and checksum-verified file transfer between peers. No server in the middle.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NodeProvider>
          <Shell>{children}</Shell>
        </NodeProvider>
      </body>
    </html>
  );
}
