// The home-screen icon: the same light as app/icon.svg, as the PNG that phones ask for.
import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "#04060b" }}>
        <div
          style={{
            display: "flex",
            width: 150,
            height: 150,
            borderRadius: 150,
            alignItems: "center",
            justifyContent: "center",
            background: "radial-gradient(circle, #fff6d8 0%, #f2c14e 28%, rgba(242,193,78,0) 70%)",
          }}
        >
          <div style={{ width: 34, height: 34, borderRadius: 34, background: "#fffaf0" }} />
        </div>
      </div>
    ),
    { width: 180, height: 180 },
  );
}
