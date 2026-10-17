import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#4f46e5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 104,
            height: 80,
            background: "#ffffff",
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderTop: "18px solid transparent",
              borderBottom: "18px solid transparent",
              borderLeft: "28px solid #4f46e5",
              marginLeft: 8,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
