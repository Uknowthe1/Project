import "./globals.css";
import { ConsoleSilencer } from "./console-silencer";

export const metadata = {
  title: "BRID Study",
  description: "고1 발표용 BRID 학습 보조 앱",
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
