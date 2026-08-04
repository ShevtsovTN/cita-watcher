/**
 * Таблица провинция → маршрут на реальном сайте `icp.administracionelectronica.gob.es`, снятая
 * вживую с `<select>` "Selecciona Provincia ..." на `/icpplus/index.html` (см.
 * ../../../docs/NODE_WORKER_ROADMAP.md Phase 1). Это НЕ единый фиксированный путь — у каждой
 * провинции свой базовый путь (`icpplus`/`icpco`/`icpplustie`/`icpplustieb`/`icpplustiem`) плюс
 * числовой `p`, поэтому список хранится как данные, а не выводится по правилу.
 */

export interface ProvinceRoute {
    readonly basePath: string;
    readonly id: number;
}

export const PROVINCE_ROUTES: Readonly<Record<string, ProvinceRoute>> = Object.freeze({
    "A Coruña": { basePath: "icpplus", id: 15 },
    Albacete: { basePath: "icpplus", id: 2 },
    Alicante: { basePath: "icpco", id: 3 },
    Almería: { basePath: "icpplus", id: 4 },
    Araba: { basePath: "icpplus", id: 1 },
    Asturias: { basePath: "icpplus", id: 33 },
    Ávila: { basePath: "icpplus", id: 5 },
    Badajoz: { basePath: "icpplus", id: 6 },
    Barcelona: { basePath: "icpplustieb", id: 8 },
    Bizkaia: { basePath: "icpplus", id: 48 },
    Burgos: { basePath: "icpplus", id: 9 },
    Cáceres: { basePath: "icpplus", id: 10 },
    Cádiz: { basePath: "icpplus", id: 11 },
    Cantabria: { basePath: "icpplus", id: 39 },
    Castellón: { basePath: "icpplus", id: 12 },
    Ceuta: { basePath: "icpplus", id: 51 },
    "Ciudad Real": { basePath: "icpplus", id: 13 },
    Córdoba: { basePath: "icpplus", id: 14 },
    Cuenca: { basePath: "icpplus", id: 16 },
    Gipuzkoa: { basePath: "icpplus", id: 20 },
    Girona: { basePath: "icpplus", id: 17 },
    Granada: { basePath: "icpplus", id: 18 },
    Guadalajara: { basePath: "icpplus", id: 19 },
    Huelva: { basePath: "icpplus", id: 21 },
    Huesca: { basePath: "icpplus", id: 22 },
    "Illes Balears": { basePath: "icpplustie", id: 7 },
    Jaén: { basePath: "icpplus", id: 23 },
    "La Rioja": { basePath: "icpplus", id: 26 },
    "Las Palmas": { basePath: "icpplustie", id: 35 },
    León: { basePath: "icpplus", id: 24 },
    Lleida: { basePath: "icpplus", id: 25 },
    Lugo: { basePath: "icpplus", id: 27 },
    Madrid: { basePath: "icpplustiem", id: 28 },
    Málaga: { basePath: "icpplustie", id: 29 },
    Melilla: { basePath: "icpplus", id: 52 },
    Murcia: { basePath: "icpplus", id: 30 },
    Navarra: { basePath: "icpplus", id: 31 },
    Ourense: { basePath: "icpplus", id: 32 },
    Palencia: { basePath: "icpplus", id: 34 },
    Pontevedra: { basePath: "icpplus", id: 36 },
    Salamanca: { basePath: "icpplus", id: 37 },
    "S.Cruz Tenerife": { basePath: "icpco", id: 38 },
    Segovia: { basePath: "icpplus", id: 40 },
    Sevilla: { basePath: "icpplus", id: 41 },
    Soria: { basePath: "icpplus", id: 42 },
    Tarragona: { basePath: "icpplus", id: 43 },
    Teruel: { basePath: "icpplus", id: 44 },
    Toledo: { basePath: "icpplus", id: 45 },
    Valencia: { basePath: "icpplus", id: 46 },
    Valladolid: { basePath: "icpplus", id: 47 },
    Zamora: { basePath: "icpplus", id: 49 },
    Zaragoza: { basePath: "icpplus", id: 50 },
});

export function resolveProvinceRoute(province: string): ProvinceRoute | undefined {
    return PROVINCE_ROUTES[province];
}

export function buildCitarUrl(route: ProvinceRoute): string {
    return `https://icp.administracionelectronica.gob.es/${route.basePath}/citar?p=${String(route.id)}&locale=es`;
}
