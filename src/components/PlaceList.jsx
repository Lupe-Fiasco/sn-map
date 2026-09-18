import TypeSelect from "./TypeSelect.jsx";

export default function PlaceList({
    places,
    types,
    unsyncedIds,
    query,
    typeFilter,
    onQuery,
    onTypeFilter,
    onSelect,
}) {
    const matches = places.features.filter(({ properties }) => {
        const haystack =
            `${properties.name} ${properties.address || ""}`.toLocaleLowerCase(
                "zh-CN",
            );
        return (
            (!typeFilter || properties.type === typeFilter) &&
            (!query.trim() ||
                haystack.includes(query.trim().toLocaleLowerCase("zh-CN")))
        );
    });
    const typeFor = (id) =>
        types.find((type) => type.id === id) ?? { name: id, color: "#65736f" };
    return (
        <>
            <div className="filters">
                <label className="sr-only" htmlFor="place-search">
                    搜索地点
                </label>
                <input
                    id="place-search"
                    type="search"
                    value={query}
                    onChange={(event) => onQuery(event.target.value)}
                    placeholder="搜索名称、地址"
                    autoComplete="off"
                />
                <label
                    className="sr-only"
                    id="type-filter-label"
                    htmlFor="type-filter"
                >
                    按类型筛选
                </label>
                <TypeSelect
                    id="type-filter"
                    value={typeFilter}
                    options={types}
                    placeholder="全部类型"
                    onChange={onTypeFilter}
                />
            </div>
            <ul className="place-list" aria-label="地点列表">
                {matches.map((feature) => {
                    const type = typeFor(feature.properties.type);
                    const unsynced = unsyncedIds.has(feature.id);
                    return (
                        <li
                            key={feature.id}
                            className={unsynced ? "unsynced-place" : ""}
                        >
                            <button
                                type="button"
                                onClick={() => onSelect(feature.id)}
                                aria-label={
                                    unsynced
                                        ? `${feature.properties.name}，尚未同步到本地文件`
                                        : undefined
                                }
                            >
                                <span
                                    className="type-swatch"
                                    style={{ background: type.color }}
                                />
                                <span className="place-name">
                                    {feature.properties.name}
                                </span>
                                <span className="place-type">
                                    {type.name} ·{" "}
                                    {feature.geometry.type === "Polygon"
                                        ? "区域"
                                        : "点"}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <p className="unsynced-legend">
                <i aria-hidden="true" />
                绿色背景地点未同步至本地文件
            </p>
            {!matches.length && (
                <p className="empty-state">
                    {places.features.length
                        ? "没有符合筛选条件的地点。"
                        : "暂无用户地点。可新增地点或区域开始维护。"}
                </p>
            )}
        </>
    );
}
