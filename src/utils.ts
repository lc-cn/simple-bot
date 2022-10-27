export function deepMerge<T>(base:T, ...from:T[]):T {
    if (from.length === 0) {
        return base;
    }
    if (typeof base !== 'object') {
        return base;
    }
    if (Array.isArray(base)) {
        return base.concat(...from) as T;
    }
    for (const item of from) {
        for (const key in item) {
            if (base.hasOwnProperty(key)) {
                if (typeof base[key] === 'object') {
                    base[key] = deepMerge(base[key], item[key]) as any;
                }
                else {
                    base[key] = item[key] as any;
                }
            }
            else {
                base[key] = item[key] as any;
            }
        }
    }
    return base;
}
export type Define<S,K extends string,T=any>={
    [P in (keyof S)|K]:P extends keyof S?S[P]:T
}