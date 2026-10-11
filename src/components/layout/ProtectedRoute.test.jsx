import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/layout/ProtectedRoute";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

function LocationProbe() {
  const location = useLocation();
  const from = location.state?.from;
  return <pre data-testid="location">{JSON.stringify({
    pathname: location.pathname,
    search: location.search,
    from: from ? { pathname: from.pathname, search: from.search, hash: from.hash } : undefined,
  })}</pre>;
}

const renderProtectedRoute = (user, initialEntry = "/transactions?filter=pending") => {
  useAuth.mockReturnValue({ user, loading: false });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LocationProbe />} />
        <Route path="/customer-dashboard/*" element={<p>Customer dashboard</p>} />
        <Route
          path="/transactions"
          element={(
            <ProtectedRoute roles={["admin", "skilled_worker"]} requiredModule="transactions">
              <p>Transactions page</p>
            </ProtectedRoute>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  useAuth.mockReset();
});

describe("ProtectedRoute refresh and role behavior", () => {
  it("keeps an authorized staff member on the directly requested route", () => {
    renderProtectedRoute({ role: "admin" });

    expect(screen.getByText("Transactions page")).toBeTruthy();
  });

  it("preserves the requested path and query when redirecting an expired session to login", () => {
    renderProtectedRoute(null);

    expect(screen.getByTestId("location").textContent).toBe(
      JSON.stringify({
        pathname: "/login",
        search: "",
        from: { pathname: "/transactions", search: "?filter=pending", hash: "" },
      }),
    );
  });

  it("does not allow a customer to enter a staff route", () => {
    renderProtectedRoute({ role: "customer" });

    expect(screen.getByText("Customer dashboard")).toBeTruthy();
    expect(screen.queryByText("Transactions page")).toBeNull();
  });
});
