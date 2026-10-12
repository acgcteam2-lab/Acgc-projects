import React, { useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Link, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import KeepAliveOutlet from "./KeepAliveOutlet";

function TestPage({ name, onMount }) {
  useEffect(() => {
    onMount(name);
  }, [name, onMount]);

  return (
    <React.Fragment>
      <h1>{name}</h1>
    </React.Fragment>
  );
}

describe("KeepAliveOutlet", () => {
  it("keeps visited routes mounted without mounting unvisited routes", async () => {
    const onMount = vi.fn();

    render(
      <MemoryRouter initialEntries={["/first"]}>
        <Link to="/first">First</Link>
        <Link to="/second">Second</Link>
        <Routes>
          <Route element={<KeepAliveOutlet />}>
            <Route path="/first" element={<TestPage name="First page" onMount={onMount} />} />
            <Route path="/second" element={<TestPage name="Second page" onMount={onMount} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "First page" });
    expect(onMount).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("link", { name: "Second" }));
    await screen.findByRole("heading", { name: "Second page" });
    expect(screen.queryByRole("heading", { name: "First page" })).toBeNull();
    expect(onMount).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("link", { name: "First" }));
    await screen.findByRole("heading", { name: "First page" });
    expect(onMount).toHaveBeenCalledTimes(2);
  });
});