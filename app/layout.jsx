import "./globals.css";
import { ConsoleSilencer } from "./console-silencer";

export const metadata = {
  title: "FOCUSMATE",
  description: "최적의 집증시간을 알려주마",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <ConsoleSilencer />
        {children}
      </body>
    </html>
  );
}
