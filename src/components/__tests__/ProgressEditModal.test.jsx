import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProgressEditModal from "../ProgressEditModal";

describe("ProgressEditModal", () => {
  it("places the mobile dialog above navigation and keeps its actions available", () => {
    render(
      <ProgressEditModal
        project={{ id: "order-123", client: "Acme Corp", stages: [] }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Edit Progress/ });
    expect(dialog.parentElement.className).toContain("z-[70]");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
  });

  it("uses In Progress by default and removes sub-stage controls and Done from Stage State", () => {
    const project = { id: "order-123", client: "Acme Corp", stages: [] };
    render(<ProgressEditModal project={project} onSave={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: /Edit Progress/ });
    expect(dialog.className).toContain("h-[100dvh]");
    expect(dialog.className).toContain("lg:max-w-[600px]");
    expect(screen.queryByRole("button", { name: /Add Sub-Stage/i })).toBeNull();
    expect(screen.getAllByLabelText("Stage State")[0].value).toBe("in_progress");
    expect(screen.queryByRole("option", { name: "Done" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark Cutting Done" })).toBeTruthy();
  });

  it("allows admins to add a new main stage", () => {
    const project = { id: "order-123", client: "Acme Corp", stages: [] };
    render(<ProgressEditModal project={project} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("New main stage name"), { target: { value: "Quality Check" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Main Stage" }));
    expect(screen.getByText("Quality Check")).toBeTruthy();
  });

  it("calls onSave and closes when save changes is clicked", async () => {
    const project = {
      id: "order-123",
      client: "Acme Corp",
      stages: [
        { name: "Cutting", completed: false, status: "pending", date: null, images: [] },
      ],
    };
    const onSave = vi.fn().mockResolvedValue();
    const onClose = vi.fn();

    render(<ProgressEditModal project={project} onSave={onSave} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("accepts a one-character delay reason", () => {
    render(
      <ProgressEditModal
        project={{ id: "order-123", client: "Acme Corp", stages: [] }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getAllByLabelText("Stage State")[0], { target: { value: "delayed" } });
    fireEvent.change(screen.getByLabelText("Delay Reason *"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Delay Reason" }));

    expect(screen.queryByRole("dialog", { name: "Project Delay Reason" })).toBeNull();
    expect(screen.getAllByLabelText("Stage State")[0].value).toBe("delayed");
  });

  it("saves Assembly after Cutting and before Fabrication", async () => {
    const onSave = vi.fn().mockResolvedValue();

    render(
      <ProgressEditModal
        project={{ id: "order-123", client: "Acme Corp", stages: [] }}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      expect(onSave.mock.calls[0][0].stages.map((stage) => stage.key)).toEqual([
        "cutting",
        "assembly",
        "fabrication",
        "installation",
      ]);
    });
  });

  it("allows proof photos to be added after a stage is completed", () => {
    const project = {
      id: "order-123",
      client: "Acme Corp",
      stages: [
        {
          name: "Cutting",
          completed: true,
          saved: true,
          status: "done",
          date: "2025-01-01",
          images: [],
          subStages: [
            { name: "Glass Preparation", description: "Prep glass.", status: "pending", completed: false, images: [] },
          ],
        },
      ],
    };
    render(<ProgressEditModal project={project} onSave={vi.fn()} onClose={vi.fn()} />);

    const imageInput = screen.getByLabelText("Upload proof images for Cutting");
    expect(imageInput.disabled).toBe(false);
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:completed-stage-proof" });
    fireEvent.change(imageInput, {
      target: { files: [new File(["proof"], "after-install.jpg", { type: "image/jpeg" })] },
    });
    expect(screen.getByText("after-install.jpg")).toBeTruthy();
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    } else {
      delete URL.createObjectURL;
    }
  });
});
