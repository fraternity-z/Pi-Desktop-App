import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComposerQueueCard } from "./ComposerQueueCard";

describe("ComposerQueueCard", () => {
  it("空队列不占据布局", () => {
    const { container } = render(
      <ComposerQueueCard
        queuedMessages={{ steering: [], followUp: [] }}
        paused={false}
        onClear={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("区分引导与后续消息并支持清空暂停队列", () => {
    const onClear = vi.fn();
    render(
      <ComposerQueueCard
        queuedMessages={{ steering: ["调整方向"], followUp: ["完成后总结"] }}
        paused
        onClear={onClear}
      />,
    );

    expect(screen.getByText("2 条排队")).toBeInTheDocument();
    expect(screen.getByText("由于你中断了当前响应，队列已暂停")).toBeInTheDocument();
    expect(screen.getByText("调整方向")).toBeInTheDocument();
    expect(screen.getByText("完成后总结")).toBeInTheDocument();
    expect(screen.getAllByText(/引导|后续/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "清空排队消息" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
