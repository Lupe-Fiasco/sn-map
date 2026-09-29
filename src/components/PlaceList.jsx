import TypeMultiSelect from "./TypeMultiSelect.jsx";
import { ui } from "../uiClassNames.js";
import { filterPlaces } from "../services/placeFiltering.js";

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
    const matches = filterPlaces(places.features, query, typeFilter);
    const typeFor = (id) =>
        types.find((type) => type.id === id) ?? { name: id, color: "#65736f" };
    return (
        <>
            {/* ai coding：筛选器与地点列表的通用布局直接使用 utility，保留未同步状态的专用视觉规则。 */}
            <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-2">
                <label className="sr-only" htmlFor="place-search">
                    搜索地点
                </label>
                <input
                    className={ui.input}
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
                {/* ai coding：类型筛选独立使用 checkbox menu；地点表单的单选 TypeSelect 语义保持不变。 */}
                <TypeMultiSelect
                    id="type-filter"
                    value={typeFilter}
                    options={types.filter((type) => !type.hidden)}
                    onChange={onTypeFilter}
                />
            </div>
            <ul className="mt-3 max-h-[310px] list-none overflow-auto p-0" aria-label="地点列表">
                {matches.map((feature) => {
                    const type = typeFor(feature.properties.type);
                    const unsynced = unsyncedIds.has(feature.id);
                    return (
                        <li
                            key={feature.id}
                            className={`border-t border-[#dbe3dd] cyber:border-[#68edff]/20 ${unsynced ? "bg-[#e8f5ec] shadow-[inset_3px_0_#31845d] cyber:bg-[rgba(38,117,91,.3)] cyber:shadow-[inset_3px_0_#5deab1]" : ""}`}
                        >
                            <button
                                className="grid w-full grid-cols-[12px_1fr_auto] items-center gap-[9px] border-0 bg-transparent px-3 py-[11px] text-left text-inherit hover:bg-[#f6f7f2] focus-visible:bg-[#f6f7f2] focus-visible:outline-none cyber:hover:bg-[rgba(26,79,105,.48)] cyber:focus-visible:bg-[rgba(26,79,105,.48)] cyber:hover:text-[#e6fbff] cyber:focus-visible:text-[#e6fbff]"
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
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[.86rem] font-bold">
                                    {feature.properties.name}
                                </span>
                                <span className={`text-xs text-[#60716d] ${ui.themeMuted}`}>
                                    {type.name} ·{" "}
                                    {feature.geometry.type === "Polygon"
                                        ? "区域"
                                        : feature.geometry.type === "LineString"
                                          ? "线"
                                        : "点"}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <p className={`mt-[10px] flex items-center gap-[7px] text-[.72rem] text-[#526560] ${ui.themeMuted}`}>
                <i className="h-[10px] w-[14px] rounded-sm border-l-[3px] border-[#31845d] bg-[#e8f5ec] cyber:border-[#5deab1] cyber:bg-[rgba(38,117,91,.3)]" aria-hidden="true" />
                绿色背景地点未同步至本地文件
            </p>
            {!matches.length && (
                <p className={`${ui.muted} mt-[14px]`}>
                    {places.features.length
                        ? "没有符合筛选条件的地点。"
                        : "暂无用户地点。可新增点、线或区域开始维护。"}
                </p>
            )}
        </>
    );
}
