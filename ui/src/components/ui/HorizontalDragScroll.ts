import { useRef, useState, type MouseEventHandler, type PointerEventHandler } from "react";
import "./HorizontalDragScroll.css";

interface DragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
}

/** Adds desktop mouse drag-scrolling without replacing native touch scrolling. */
export function useHorizontalDragScroll<T extends HTMLElement>() {
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown: PointerEventHandler<T> = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  };

  const onPointerMove: PointerEventHandler<T> = (event) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = event.clientX - current.startX;
    if (!current.moved && Math.abs(distance) < 5) return;
    if (!current.moved) {
      current.moved = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = current.startScrollLeft - distance;
  };

  const finishDrag: PointerEventHandler<T> = (event) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setDragging(false);
    if (current.moved) window.setTimeout(() => { suppressClick.current = false; }, 0);
  };

  const onClickCapture: MouseEventHandler<T> = (event) => {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    dragScrollProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onClickCapture,
    },
    dragScrollClassName: `ui-horizontal-drag-scroll${dragging ? " ui-horizontal-drag-scroll--dragging" : ""}`,
  };
}
