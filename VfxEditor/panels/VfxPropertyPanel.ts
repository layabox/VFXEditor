import type { IVfxGraphData, IVfxPropertyDef } from "../data/VfxTypes";
import { getPropSettingsRegistryId } from "../data/VfxNodeDefs";

/** 属性类型选项 */
const PROPERTY_TYPES = [
    { label: "Float", type: "number", default: 0 },
    { label: "Int", type: "int", default: 0 },
    { label: "Bool", type: "bool", default: false },
    { label: "Vector2", type: "vec2", default: { x: 0, y: 0 } },
    { label: "Vector3", type: "vec3", default: { x: 0, y: 0, z: 0 } },
    { label: "Vector4", type: "vec4", default: { x: 0, y: 0, z: 0, w: 0 } },
    { label: "Color", type: "color", default: { r: 1, g: 1, b: 1, a: 1 } },
    { label: "Gradient", type: "Gradient", default: { stops: [{ t: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { t: 1, color: { r: 1, g: 1, b: 1, a: 0 } }] } },
    { label: "Texture2D", type: "Texture2D", default: null },
    { label: "Mesh", type: "Mesh", default: null },
    { label: "Graphics Buffer", type: "GraphicsBuffer", default: null },
];

const NUMERIC_TYPES = new Set(["number", "int"]);
const HEADER_H = 28;
const ROW_GAP = 4;
const BOX_PAD = 4;
const BOX_MARGIN_H = 8;
const INSP_HEIGHT = 200;

interface IRowEntry {
    widget: gui.Widget;
    propIndex: number;
    headerBg: gui.Shape;
}

/**
 * VFX Graph Property 组件（Blackboard）
 * 使用 DataInspector 渲染属性设置
 * 由 VfxGraphPanel 持有，嵌入左栏。
 */
export class VfxPropertyPanel {
    panel: gui.Widget;

    private _list: gui.Widget;
    private _inspWidget: gui.Widget;
    private _tree: gui.Tree;
    private _graphData: IVfxGraphData | null = null;
    private _rows: IRowEntry[] = [];
    private _selectedIndex: number = -1;
    private _di: IEditor.IDataInspector | null = null;

    async create(parent: gui.Widget): Promise<void> {
        this.panel = gui.UIPackage.createWidgetSync("editorResources/vfx/UI/VfxPropertyPanel.widget");
        this.panel.addRelation(parent, gui.RelationType.Size);
        this.panel.setSize(parent.width, parent.height);
        parent.addChild(this.panel);

        const header = this.panel.getChild("header", gui.Widget);
        // widget 里 title 默认 "Properties"，运行时按当前语言覆盖（通用词走全局 i18n 表）
        const titleField = header.getChild("title", gui.TextField);
        if (titleField) titleField.text = i18n.t("property");
        const addBtn = header.getChild("addBtn", gui.TextField);
        addBtn.on("pointer_down", (e: gui.Event) => {
            if (e.input.button !== 0) return;
            e.stopPropagation();
            this._showAddMenu();
        }, this);

        this._list = this.panel.getChild("list", gui.Widget);

        // 复用 BPInspectorPanel 的 Tree 控件，放入 list 中
        this._inspWidget = await gui.UIPackage.createWidget("~/ui/blueprintEditor2/BPInspectorPanel.widget");
        this._tree = this._inspWidget.getChild("list", gui.Tree);
        this._inspWidget.visible = false;
        this._inspWidget.on("pointer_down", (e: gui.Event) => {
            if (e.input.button === 2 && this._selectedIndex >= 0) {
                e.stopPropagation();
                IEditor.Menu.create([
                    { label: i18n.t("delete"), click: () => this._removeProperty(this._selectedIndex) },
                ]).show(this.panel);
            }
        }, this);
        this._list.addChild(this._inspWidget);
    }

    setGraphData(graphData: IVfxGraphData): void {
        this._graphData = graphData;
        if (!graphData.properties) graphData.properties = [];
        this._rebuild();
    }

    private _showAddMenu(): void {
        if (!this._graphData) return;
        const items = PROPERTY_TYPES.map(pt => ({
            label: pt.label,
            click: () => this._addProperty(pt.type, pt.default),
        }));
        IEditor.Menu.create(items).show(this.panel);
    }

    private _addProperty(type: string, defaultValue: any): void {
        if (!this._graphData) return;
        if (!this._graphData.properties) this._graphData.properties = [];

        const existingNames = new Set(this._graphData.properties.map((p: IVfxPropertyDef) => p.name));
        let name = "NewProperty";
        let idx = 0;
        while (existingNames.has(name)) { idx++; name = `NewProperty${idx}`; }

        this._graphData.properties.push({
            name, type,
            default: typeof defaultValue === "object" && defaultValue !== null
                ? JSON.parse(JSON.stringify(defaultValue)) : defaultValue,
            exposed: true,
            mode: NUMERIC_TYPES.has(type) ? "Default" : undefined,
        });
        this._rebuild();
    }

    private _removeProperty(index: number): void {
        if (!this._graphData?.properties) return;
        const propName = this._graphData.properties[index].name;
        this._graphData.properties.splice(index, 1);

        // 删除引用该 property 的 getProperty operator 及其连线
        this._removeGetPropertyNodes(propName);

        this._rebuild();
    }

    /** 删除所有引用指定 property 的 getProperty operator 节点 */
    private _removeGetPropertyNodes(propName: string): void {
        if (!this._graphData) return;
        const ops = this._graphData.operators;

        // 收集要删除的 operator ID
        const removeIds = new Set<number>();
        for (const op of ops) {
            if (op.typeId === "getProperty" && op.props?.property === propName) {
                removeIds.add(op.id);
            }
        }
        if (removeIds.size === 0) return;

        // 清除其他 operator 中指向这些节点的连线
        for (const op of ops) {
            if (removeIds.has(op.id) || !op.output) continue;
            for (const sid of Object.keys(op.output)) {
                const arr = op.output[sid].infoArr;
                for (let i = arr.length - 1; i >= 0; i--) {
                    if (removeIds.has(arr[i].nodeId)) arr.splice(i, 1);
                }
            }
        }

        // 从数据数组中移除
        for (let i = ops.length - 1; i >= 0; i--) {
            if (removeIds.has(ops[i].id)) ops.splice(i, 1);
        }
    }

    // ── Layout ──

    private _rebuild(): void {
        for (const r of this._rows) {
            if (r.widget.parent) r.widget.parent.removeChild(r.widget);
        }
        this._rows.length = 0;
        this._selectedIndex = -1;
        this._clearInspector();

        if (!this._graphData?.properties) return;

        const W = this._list.width || 250;
        for (let i = 0; i < this._graphData.properties.length; i++) {
            this._createRow(this._graphData.properties[i], i, W);
        }
        this._relayout();
    }

    private _relayout(): void {
        const W = this._list.width || 250;
        const cardW = W - BOX_MARGIN_H * 2;
        let y = ROW_GAP;
        for (let i = 0; i < this._rows.length; i++) {
            const isExpanded = i === this._selectedIndex && this._inspWidget.visible;
            const rowH = isExpanded ? HEADER_H + INSP_HEIGHT + BOX_PAD : HEADER_H;

            this._rows[i].widget.y = y;
            this._rows[i].widget.height = rowH;
            this._rows[i].headerBg.setSize(cardW, rowH);

            if (isExpanded) {
                // inspector 嵌入框内，紧接 header 下方
                this._inspWidget.setPos(BOX_MARGIN_H, y + HEADER_H);
                this._inspWidget.setSize(cardW, INSP_HEIGHT);
                this._list.setChildIndex(this._inspWidget, this._list.numChildren - 1);
            }

            y += rowH + ROW_GAP;
        }
        this._list.height = y;
    }

    // ── Row creation ──

    private _createRow(prop: IVfxPropertyDef, index: number, W: number): void {
        const cardW = W - BOX_MARGIN_H * 2;
        const row = gui.UIPackage.createWidgetSync("editorResources/vfx/UI/VfxPropertyRow.widget");
        row.x = BOX_MARGIN_H;
        row.setSize(cardW, HEADER_H);

        const headerBg = row.getChild("headerBg", gui.Shape);
        headerBg.setSize(cardW, HEADER_H);

        // 右键菜单
        const showContextMenu = () => {
            IEditor.Menu.create([
                { label: i18n.t("delete"), click: () => this._removeProperty(index) },
            ]).show(this.panel);
        };

        // 统一 pointer_down 处理（左键选中 / 右键菜单）
        const onPointerDown = (e: gui.Event) => {
            if (e.input.button === 0) {
                e.stopPropagation();
                this._selectRow(index);
            } else if (e.input.button === 2) {
                e.stopPropagation();
                showContextMenu();
            }
        };

        // fold arrow
        const foldBtn = row.getChild("foldBtn", gui.TextField);
        foldBtn.on("pointer_down", onPointerDown, this);

        // name
        const nameInput = row.getChild("nameInput", gui.TextInput);
        nameInput.text = prop.name;
        nameInput.setSize(cardW - 120, 20);
        nameInput.on("focus_out", () => {
            const n = nameInput.text.trim();
            if (n && n !== prop.name) prop.name = n;
            else nameInput.text = prop.name;
        }, this);
        nameInput.on("key_down", (e: gui.Event) => {
            if (e.input.key === "Enter") nameInput.element.blur();
        }, this);
        nameInput.on("pointer_down", onPointerDown, this);

        // type label
        const typeLabel = row.getChild("typeLabel", gui.TextField);
        typeLabel.text = PROPERTY_TYPES.find(t => t.type === prop.type)?.label || prop.type;
        typeLabel.touchable = true;
        typeLabel.on("pointer_down", onPointerDown, this);

        // header background
        headerBg.on("pointer_down", onPointerDown, this);

        const entry: IRowEntry = { widget: row, propIndex: index, headerBg };
        this._rows.push(entry);
        this._list.addChild(row);
    }

    // ── Selection & Inspector ──

    private _selectRow(index: number): void {
        if (this._selectedIndex === index) {
            // deselect
            this._selectedIndex = -1;
            this._clearInspector();
            this._updateRowHighlights();
            this._relayout();
            return;
        }

        this._selectedIndex = index;
        this._updateRowHighlights();
        this._showInspector(index);
        this._relayout();
    }

    private _updateRowHighlights(): void {
        for (let i = 0; i < this._rows.length; i++) {
            const row = this._rows[i];
            const selected = i === this._selectedIndex;
            const bg = row.headerBg.getGraphics(gui.SRect);
            bg.fillColor.parse(selected ? "#252525" : "#2e2e2e");

            const foldBtn = row.widget.getChild("foldBtn", gui.TextField);
            foldBtn.text = selected ? "\u25BC" : "\u25B6";
            foldBtn.color = selected ? 0xDDDDDD : 0x666666;
        }
    }

    private _showInspector(index: number): void {
        this._clearInspector();

        const prop = this._graphData!.properties![index];
        const typeId = getPropSettingsRegistryId(prop.type);

        this._di = new IEditor.DataInspector(typeId);
        this._di.setTitle("");
        this._di.catalogs.forEach(node => {
            this._tree.rootNode.addChild(node);
            // 隐藏 catalog 标题栏：高度设 0 + alpha 0，但保持 visible=true，避免 foldInvisibles 折叠子节点
            if (node.cell) {
                node.cell.height = 0;
                node.cell.alpha = 0;
            }
        });
        this._di.setData(prop);

        this._inspWidget.visible = true;
    }

    private _clearInspector(): void {
        this._tree.rootNode.removeChildren();
        this._di = null;
        this._inspWidget.visible = false;
    }
}
