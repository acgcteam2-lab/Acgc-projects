import React, { useState } from "react";
import { useLocation, useOutlet } from "react-router-dom";

export default function KeepAliveOutlet() {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const [cachedOutlets, setCachedOutlets] = useState(() => new Map());

  if (outlet && !cachedOutlets.has(pathname)) {
    setCachedOutlets(new Map(cachedOutlets).set(pathname, outlet));
  }

  const outletsToRender = new Map(cachedOutlets);
  if (outlet) outletsToRender.set(pathname, outlet);

  return (
    <React.Fragment>
      {Array.from(outletsToRender, ([routePath, routeOutlet]) => {
        const isActive = routePath === pathname;
        return (
          <div key={routePath} hidden={!isActive}>
            {routeOutlet}
          </div>
        );
      })}
    </React.Fragment>
  );
}