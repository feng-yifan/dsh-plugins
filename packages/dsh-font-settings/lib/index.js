var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import z from '@deepseek-ai/schemastery';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { getFonts } from 'font-list';
/** 插件名（= cordis.patch.yml 行 id = 设置文档命名空间）。 */
export const name = 'dsh-font-settings';
/** 设置文档字段：正文/界面默认字体（空串 = 不覆盖，沿用 DSH 默认栈）。 */
export const UI_FONT_FIELD = 'uiFont';
/** 设置文档字段：等宽字体（空串 = 不覆盖）。 */
export const MONO_FONT_FIELD = 'monoFont';
/** volatile → 设置文档允许写入并持久化到 profile patch。 */
export const Config = z.object({
    uiFont: z.string().default('').volatile(),
    monoFont: z.string().default('').volatile(),
});
/**
 * 系统字体列表宿主服务。
 *
 * 经 Typert Gateway 暴露为 wire 命名空间 `dshFonts`
 * （HTTP: POST /api/dshFonts/list）。底层用 font-list 跨平台枚举
 * （macOS: 预编译 CoreText 二进制；Windows: PowerShell/VBS；Linux: fc-list），
 * 三平台共用同一条调用路径，浏览器半侧用同源 fetch 调用，
 * 无需权限弹窗、与浏览器无关。
 */
let FontsController = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _list_decorators;
    return class FontsController extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _list_decorators = [Remote];
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        listPromise = (__runInitializers(this, _instanceExtraInitializers), null);
        constructor(ctx) {
            super(ctx, 'dshFontList', { namespace: 'dshFonts' });
        }
        /** 返回去重排序的系统字体族名列表；枚举失败时返回空数组。 */
        async list() {
            this.listPromise ??= getFonts({ disableQuoting: true })
                .then((fonts) => [...new Set(fonts.map((family) => family.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
                .catch(() => []);
            return this.listPromise;
        }
    };
})();
export { FontsController };
/**
 * 行存在即加载。设置表单派生自 Config；关闭自动生成页（auto: false），
 * 自建的设置行由浏览器半侧注册。
 */
export function apply(ctx) {
    ctx.inject(['settings'], (child) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    });
    // 注册字体枚举服务：cordis Service 构造器自动注册，随本 fiber 卸载。
    new FontsController(ctx);
}
//# sourceMappingURL=index.js.map