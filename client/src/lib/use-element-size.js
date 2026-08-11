import { useLayoutEffect, useRef, useState } from 'react';

/** Measured content box of an element, kept live via ResizeObserver. */
export function useElementSize() {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) =>
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
        );
        observer.observe(el);
        // Seed with the content box too — clientWidth/Height include padding,
        // which would disagree with what the observer reports.
        const cs = getComputedStyle(el);
        setSize({
            width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
            height: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
        });
        return () => observer.disconnect();
    }, []);

    return [ref, size];
}
