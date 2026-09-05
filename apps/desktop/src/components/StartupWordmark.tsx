import { useId, type CSSProperties } from "react";

import { STARTUP_WORDMARK } from "../assets/startup-wordmark";
import wordmarkLicense from "../assets/startup-wordmark-LICENSE.txt?raw";

export function StartupWordmark() {
  const instanceId = useId();

  return (
    <svg
      className="startup-handwriting"
      viewBox="0 0 560 196"
      aria-hidden="true"
      focusable="false"
    >
      <metadata>{wordmarkLicense}</metadata>
      <g transform="translate(20 118) scale(.166 -.166)">
        <defs>
          {STARTUP_WORDMARK.letters.map((letter) => {
            const [left, bottom, right, top] = letter.bounds;
            return (
              <mask
                key={letter.id}
                id={`${instanceId}-${letter.id}`}
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
                x={left - 2}
                y={bottom - 2}
                width={right - left + 4}
                height={top - bottom + 4}
                style={{ maskType: "luminance" }}
              >
                {letter.strokes.map((stroke, index) => (
                  <path
                    key={index}
                    className="startup-handwriting-stroke"
                    d={stroke.d}
                    pathLength={1}
                    fill="none"
                    stroke="white"
                    strokeWidth={letter.maskWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      "--stroke-delay": `${stroke.delay}ms`,
                      "--stroke-duration": `${stroke.duration}ms`,
                    } as CSSProperties}
                  />
                ))}
                <rect
                  className="startup-handwriting-mask-finish"
                  x={left - 2}
                  y={bottom - 2}
                  width={right - left + 4}
                  height={top - bottom + 4}
                  fill="white"
                  style={{
                    "--stroke-delay": `${letter.finish}ms`,
                    "--stroke-duration": "40ms",
                  } as CSSProperties}
                />
              </mask>
            );
          })}
        </defs>
        {STARTUP_WORDMARK.letters.map((letter) => (
          <g key={letter.id} transform={`translate(${letter.x} ${letter.y})`}>
            <g
              className="startup-handwriting-letter"
              mask={`url(#${instanceId}-${letter.id})`}
            >
              <path d={letter.outline} fill="currentColor" stroke="none" />
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}
