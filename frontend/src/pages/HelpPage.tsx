import { useState } from 'react';
import { HelpCircle, ChevronDown } from 'lucide-react';

interface Shot {
  src: string;
  caption: string;
}

interface ManualModule {
  id: string;
  num: number;
  name: string;
  tagline: string;
  what: string;
  features: string[];
  shots: Shot[];
}

interface ManualGroup {
  id: string;
  name: string;
  desc: string;
  modules: ManualModule[];
}

const INTRO: ManualModule = {
  id: 'inicio-de-sesion',
  num: 0,
  name: 'Inicio de sesión',
  tagline: 'La puerta de entrada',
  what: 'Cada organización es un espacio de trabajo aislado: el acceso pide Organización, correo y contraseña, de modo que los datos de una aerolínea nunca se mezclan con los de otra dentro de la misma plataforma.',
  features: [
    'El rol del usuario (Admin, Supervisor, Técnico, Inspector) determina qué acciones puede realizar una vez adentro — por ejemplo, solo Admin e Inspector pueden cerrar una Orden de Trabajo.',
  ],
  shots: [{ src: '/manual/01-login.jpg', caption: 'Pantalla de acceso' }],
};

const GROUPS: ManualGroup[] = [
  {
    id: 'control-de-mantenimiento',
    name: 'Control de Mantenimiento',
    desc: 'El programa de mantenimiento de cada aeronave: qué tareas existen, cuándo vencen y qué se ha cumplido.',
    modules: [
      {
        id: 'aeronaves',
        num: 1,
        name: 'Aeronaves',
        tagline: 'Registro maestro de la flota',
        what: 'Lista todas las aeronaves de la organización con sus datos básicos — matrícula, fabricante, modelo, número de serie, horas y ciclos totales — y el estado operacional de cada una a simple vista.',
        features: [
          'Panel «Registrar contadores» siempre visible arriba de la tabla, para cargar una lectura de horas/ciclos de cualquier aeronave o motor en segundos, sin entrar a cada ficha.',
          'Columna «Próx. tarea» y «Vto. CdN» para detectar de un vistazo qué aeronave necesita atención primero.',
          'Filtros por estado, propietario y modelo; clic en cualquier fila abre la ficha completa.',
          'Botón «Nueva aeronave» para incorporar una unidad a la flota.',
        ],
        shots: [{ src: '/manual/03-aeronaves-lista.jpg', caption: 'Listado de flota con el panel de contadores compactado arriba' }],
      },
      {
        id: 'ficha-de-aeronave',
        num: 2,
        name: 'Ficha de aeronave',
        tagline: 'Vista 360° de una aeronave',
        what: 'El detalle de una aeronave puntual: sus planes de mantenimiento activos organizados por las cuatro normativas que gobiernan el programa (fabricante, DGAC, componentes de motor, país de origen), sus datos generales y sus contadores.',
        features: [
          'Cuatro tarjetas de normativa muestran de inmediato si hay planes cargados o si falta configurarlos.',
          'Sección de motores con sus propios contadores independientes de la célula.',
          'Acceso directo a «Nueva Solicitud de Trabajo» y al «Reporte DGAC» de esa aeronave.',
          'Alternar entre vista «Cómoda» y «Compacta» según cuánta densidad de información se necesite.',
        ],
        shots: [{ src: '/manual/04-aeronaves-ficha.jpg', caption: 'Ficha de la aeronave XA-AGU' }],
      },
      {
        id: 'componentes',
        num: 3,
        name: 'Componentes',
        tagline: 'Trazabilidad de partes con vida limitada',
        what: 'Controla cada componente instalado en una aeronave o motor que tiene su propia tarea de control — P/N, S/N, intervalo, último cumplimiento y remanente — independiente del resto del programa.',
        features: [
          'Tarjetas de resumen: cuántos componentes están vencidos, próximos a vencer, al día o sin control configurado.',
          '«Historial de aplicaciones» e «Historial de movimientos» son colapsables: se abren solo cuando se necesitan, para no saturar la pantalla con una tabla que se consulta ocasionalmente.',
          'Filtro por aeronave y por tipo (Aeronave / Motor) en la parte superior.',
        ],
        shots: [{ src: '/manual/05-componentes.jpg', caption: 'Control de componentes de la aeronave XA-IRC' }],
      },
      {
        id: 'cumplimientos',
        num: 4,
        name: 'Cumplimientos',
        tagline: 'Estado actual de cada tarea',
        what: 'Fotografía del estado de todas las tareas del programa de una aeronave: cuándo se cumplió cada una por última vez, con cuántas horas/ciclos de aeronave, y cuándo vence la próxima.',
        features: [
          'Pestañas «Todos / Componentes / General» clasifican las tareas según si están vinculadas a un componente físico o no.',
          'Columnas ordenables y encabezado fijo para revisar tablas largas sin perder el contexto de las columnas.',
          'Es la vista de consulta rápida; el libro legal de cumplimientos ya firmados vive en «Conformidades», dentro de Oficina Técnica.',
        ],
        shots: [{ src: '/manual/06-cumplimientos.jpg', caption: 'Cumplimientos de la aeronave XA-AGU' }],
      },
      {
        id: 'plan-de-mantenimiento',
        num: 5,
        name: 'Plan de Mantenimiento',
        tagline: 'El corazón operativo del programa',
        what: 'Muestra todas las tareas de mantenimiento de una aeronave agrupadas primero por Equipo (Aeronave o Motor) y luego por Categoría (Programa, AD, SB, MIM, Inspecciones, Componentes) — el mismo flujo de navegación progresiva que usaba la aplicación Access original, pensado para no abrumar con todo el programa de una sola vez.',
        features: [
          'Tarjetas de riesgo operacional arriba: tareas vencidas, próximas, en solicitud y sin registro.',
          'Equipo y Categoría están resaltados con el color de marca de la plataforma para señalar que son los dos filtros que realmente importan antes de mirar una tarea puntual.',
          'Botón «Agregar tarea» para sumar ítems al programa y «Ver solicitudes» para saltar directo a las ST que ya cubren tareas críticas.',
          'Desde cada tarea se abre su historial de cumplimientos sin salir de la pantalla.',
        ],
        shots: [{ src: '/manual/07-plan-mantenimiento.jpg', caption: 'Plan de Mantenimiento con Equipo y Categoría expandidos' }],
      },
      {
        id: 'biblioteca-de-mantenimiento',
        num: 6,
        name: 'Biblioteca de Mantenimiento',
        tagline: 'Plantillas reutilizables por modelo',
        what: 'Guarda programas de mantenimiento tipo, organizados por marca y modelo de aeronave, en las mismas cuatro normativas del Plan de Mantenimiento.',
        features: [
          'Evita recrear el programa completo cada vez que se incorpora una aeronave nueva del mismo modelo a la flota.',
          'Buscador por marca o modelo para ubicar rápido la plantilla correcta.',
        ],
        shots: [{ src: '/manual/08-biblioteca.jpg', caption: 'Biblioteca de Mantenimiento, normativa de fabricante' }],
      },
      {
        id: 'solicitud-de-trabajo',
        num: 7,
        name: 'Solicitud de Trabajo',
        tagline: 'Donde nace el trabajo a ejecutar',
        what: 'Una Solicitud de Trabajo (ST) agrupa una o más tareas del plan que se quieren llevar a ejecución. La crea siempre un usuario — no existen borradores generados automáticamente — y desde ahí se envía a Oficina Técnica para convertirse en trabajo real.',
        features: [
          'Tarjetas de conteo por estado: borradores, en proceso, canceladas.',
          'Cada fila permite abrir el borrador, editarlo, enviarlo, descargar su PDF o ver su historial sin salir de la lista.',
          'Vista «Cómoda» o «Compacta» y filtros por aeronave, estado y texto libre.',
        ],
        shots: [
          { src: '/manual/09-st-lista.jpg', caption: 'Listado de Solicitudes de Trabajo' },
          { src: '/manual/10-st-detalle.jpg', caption: 'Detalle de una ST: acciones, ítems, adjuntos e historial' },
        ],
      },
      {
        id: 'alteraciones-por-aeronave',
        num: 8,
        name: 'Alteraciones por Aeronave',
        tagline: 'Modificaciones aprobadas a la configuración',
        what: 'Registra las alteraciones aprobadas a la configuración física de una aeronave — STC y Formularios DGAC 337 — junto con el suplemento de manual (FMS) y la instrucción de aeronavegabilidad continuada (ICA) que las respaldan.',
        features: [
          'Buscador por documento, STC, OT o taller.',
          'Tarjetas de resumen: cuántas alteraciones tienen suplemento de manual o ICA asociada.',
        ],
        shots: [{ src: '/manual/11-alteraciones.jpg', caption: 'Alteraciones registradas para XA-AGU' }],
      },
      {
        id: 'remanentes',
        num: 9,
        name: 'Remanentes Operacionales',
        tagline: 'Cuánto le queda a cada tarea, calculado solo',
        what: 'Calcula automáticamente, a partir del último cumplimiento y las horas/ciclos actuales de la aeronave, cuánto remanente le queda a cada tarea del programa — en horas, ciclos o calendario.',
        features: [
          'Botón «Generar OT pendientes»: crea de inmediato una Orden de Trabajo con las tareas vencidas o próximas a vencer de esa aeronave, sin tener que armarla tarea por tarea.',
          '«Descargar informe PDF» exporta el detalle de vencimientos de la flota para planificación.',
          'Filtros por tipo de tarea (AD, SB/TB, Inspecciones, Componentes, Componentes de motor) y por dimensión operacional (horas, calendario, ciclos).',
          'Buscador por teclado y columnas ordenables para encontrar una tarea puntual en flotas grandes.',
        ],
        shots: [{ src: '/manual/12-remanentes.jpg', caption: 'Remanentes de XA-AGU, con «Generar OT pendientes»' }],
      },
    ],
  },
  {
    id: 'oficina-tecnica',
    name: 'Oficina Técnica',
    desc: 'El trabajo ya en ejecución: órdenes de trabajo reales, con técnicos e inspectores, y el libro de cumplimientos que dejan al cerrarse.',
    modules: [
      {
        id: 'ordenes-de-trabajo',
        num: 10,
        name: 'Órdenes de Trabajo',
        tagline: 'El trabajo real en el hangar',
        what: 'Cada Orden de Trabajo (OT) agrupa tareas del plan de mantenimiento con un técnico y un inspector asignados, y avanza por un ciclo de vida propio hasta cerrarse.',
        features: [
          'Tarjetas de conteo por estado: borrador, abierta, en ejecución, calidad, cerrada.',
          'Aviso destacado cuando hay OTs pendientes de asignación.',
          'Filtro por aeronave, por estado y buscador por número o título de OT.',
        ],
        shots: [{ src: '/manual/13-ot-lista.jpg', caption: 'Listado de Órdenes de Trabajo' }],
      },
      {
        id: 'detalle-de-ot',
        num: 11,
        name: 'Detalle de OT',
        tagline: 'Dos flujos que avanzan juntos',
        what: 'El detalle de una OT combina dos vistas del mismo trabajo: el stepper de ciclo de vida (Planificación → Hangar → Ejecución → Calidad → Histórico) y el flujo de asignación entre técnico e inspector (Pendiente → Asignado → En ejecución → Evidencia → Cerrada).',
        features: [
          'Cerrar una OT exige evidencia subida — no se puede saltar ese paso — y al cerrarse genera automáticamente los Cumplimientos correspondientes a las tareas completadas.',
          'Sección de tareas con su estado de completitud y de hallazgos/discrepancias detectadas durante la ejecución.',
          'Descarga de PDF y envío por correo directamente desde el detalle.',
        ],
        shots: [{ src: '/manual/14-ot-detalle.jpg', caption: 'OT en etapa de Calidad, con su flujo de asignación' }],
      },
      {
        id: 'conformidades',
        num: 12,
        name: 'Conformidades',
        tagline: 'El libro real de cumplimientos',
        what: 'Es el registro legal de lo efectivamente cumplido: cada fila se genera automáticamente al cerrar una ST o una OT, con la fecha, las horas/ciclos de la aeronave en ese momento, el próximo vencimiento y quién firmó.',
        features: [
          'Selector de aeronave y buscador por tarea, matrícula, OT/ST o quién firmó.',
          'Botón «Informe de cumplimiento (PDF)» para exportar el libro de una aeronave, listo para presentar a la DGAC o a una auditoría.',
          'A diferencia de «Cumplimientos» (que muestra el estado actual de cada tarea), esta pantalla es histórica: cada fila es un hecho ya ocurrido y firmado.',
        ],
        shots: [{ src: '/manual/15-conformidades.jpg', caption: 'Libro de Conformidades, todas las aeronaves' }],
      },
    ],
  },
  {
    id: 'general',
    name: 'General',
    desc: 'Vista gerencial, informes para terceros, alertas y la configuración de la organización.',
    modules: [
      {
        id: 'dashboard',
        num: 13,
        name: 'Dashboard',
        tagline: 'Panorama gerencial de la flota',
        what: 'La pantalla de entrada: disponibilidad de la flota, vencimientos próximos agrupados por urgencia (7, 15 y 30 días) y la carga de trabajo actual repartida por estado de OT.',
        features: [
          'Vista de semáforo: cuántas aeronaves están operacionales, en mantenimiento o en estado crítico/AOG.',
          'Cada segmento, barra o estado es clickeable y navega directo a la vista filtrada correspondiente — no hay que volver a aplicar el filtro a mano.',
          'Tabla de flota con buscador por matrícula y filtros por estado, propietario y modelo.',
        ],
        shots: [{ src: '/manual/02-dashboard.jpg', caption: 'Dashboard de Flota' }],
      },
      {
        id: 'reportes',
        num: 14,
        name: 'Reportes',
        tagline: 'KPIs en vivo e informes descargables',
        what: 'Combina indicadores de flota en vivo (aeronaves, horas totales, tareas vencidas, tareas al día) con cuatro informes ejecutivos en PDF, listos para presentar fuera de la plataforma.',
        features: [
          'Informe Ejecutivo de Flota: disponibilidad, horas y vencimientos por aeronave, para gerencia.',
          'Vencimientos de Flota: tareas vencidas y próximas a vencer en toda la flota, para planificar mantenimiento.',
          'Horas-Hombre por OT: horas y costo ESTIMADO de las órdenes cerradas, según el plan de mantenimiento — se etiqueta explícitamente como estimado porque la plataforma aún no captura horas reales por tarea.',
          'Cumplimiento Regulatorio por aeronave, descargable también desde Conformidades.',
          'Gráficos de tareas vencidas por aeronave y de distribución global de tareas (al día / próximas / vencidas).',
        ],
        shots: [{ src: '/manual/16-reportes.jpg', caption: 'Reportes: KPIs de flota y los 4 informes en PDF' }],
      },
      {
        id: 'notificaciones',
        num: 15,
        name: 'Notificaciones',
        tagline: 'Centro de alertas',
        what: 'Reúne las alertas de toda la flota en un solo lugar — aeronaves AOG, certificados de navegabilidad y seguros por vencer, tareas próximas — clasificadas por severidad.',
        features: [
          'Pestañas Crítica / Próxima / Gestión para filtrar rápido según urgencia.',
          'El contador de no leídas se mantiene sincronizado entre esta pantalla y el ícono de campana del menú lateral.',
          '«Marcar todo como leído» limpia el centro completo de una vez.',
        ],
        shots: [{ src: '/manual/17-notificaciones.jpg', caption: 'Centro de Notificaciones' }],
      },
      {
        id: 'configuracion',
        num: 16,
        name: 'Configuración',
        tagline: 'Identidad y datos base de la organización',
        what: 'Perfil del usuario y su rol, logo de la organización, contadores disponibles y manuales de referencia vigentes por modelo.',
        features: [
          'El logo subido aquí se incrusta automáticamente en el encabezado de todos los PDF generados por la plataforma — Solicitudes de Trabajo, Órdenes de Trabajo e informes de Remanentes y Reportes.',
          '«Contadores» define qué mide el avance de cada aeronave o motor — son los que gobiernan todos los vencimientos del plan.',
          '«Manuales de referencia» guarda el documento vigente por modelo, el que se cita al cerrar una orden de trabajo.',
        ],
        shots: [{ src: '/manual/18-configuracion.jpg', caption: 'Configuración, con la sección de logo de la empresa' }],
      },
    ],
  },
];

const TIP: ManualModule = {
  id: 'menu-lateral-colapsable',
  num: 17,
  name: 'Menú lateral colapsable',
  tagline: 'Más espacio de trabajo cuando se necesita',
  what: 'El menú lateral se puede reducir a solo íconos con el botón «Colapsar menú», dejando más ancho disponible para tablas y paneles en pantallas pequeñas.',
  features: [
    'Al pasar el mouse sobre un ícono colapsado aparece el nombre del módulo, así nunca se pierde la referencia de dónde se está parado.',
    'La preferencia queda guardada en el navegador: cada usuario decide si prefiere el menú fijo y expandido o colapsado, y la plataforma lo recuerda la próxima vez que entra.',
  ],
  shots: [{ src: '/manual/19-menu-colapsado.jpg', caption: 'Menú lateral colapsado, mostrando solo íconos' }],
};

function ModuleCard({ mod, open, onToggle }: { mod: ManualModule; open: boolean; onToggle: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/60 transition-colors"
      >
        <span className="font-mono text-xs font-bold text-brand-700 bg-brand-50 rounded-md px-2 py-1 shrink-0">
          {String(mod.num).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">{mod.name}</h3>
          <p className="text-xs text-slate-500 italic truncate">{mod.tagline}</p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-100">
          <p className="text-sm text-slate-700 leading-relaxed max-w-[68ch]">{mod.what}</p>
          <ul className="mt-4 space-y-2 max-w-[68ch]">
            {mod.features.map((f, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-slate-600 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className={`mt-5 grid gap-4 ${mod.shots.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {mod.shots.map((s) => (
              <figure key={s.src} className="m-0">
                <div className="rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                  <img src={s.src} alt={s.caption} loading="lazy" className="w-full h-auto block" />
                </div>
                <figcaption className="mt-1.5 text-[11px] font-mono text-slate-400">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const allIds = [INTRO, ...GROUPS.flatMap((g) => g.modules), TIP].map((m) => m.id);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set([INTRO.id]));

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => setOpenIds(new Set(allIds));
  const collapseAll = () => setOpenIds(new Set());

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <HelpCircle size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Manual de Uso</h1>
            <p className="text-sm text-slate-500">
              Guía módulo por módulo: qué hace cada pantalla y para qué sirve.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={expandAll} className="btn-secondary text-xs">Expandir todo</button>
          <button type="button" onClick={collapseAll} className="btn-secondary text-xs">Colapsar todo</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[{ id: INTRO.id, name: 'Inicio de sesión' }, ...GROUPS.map((g) => ({ id: g.id, name: g.name })), { id: TIP.id, name: 'Navegación' }].map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-full px-3 py-1.5 transition-colors"
          >
            {g.name}
          </a>
        ))}
      </div>

      <section id={INTRO.id} className="scroll-mt-6 space-y-3">
        <ModuleCard mod={INTRO} open={openIds.has(INTRO.id)} onToggle={() => toggle(INTRO.id)} />
      </section>

      {GROUPS.map((g) => (
        <section key={g.id} id={g.id} className="scroll-mt-6 space-y-3">
          <div className="pt-2">
            <p className="text-[11px] font-mono uppercase tracking-widest text-brand-600">{g.name}</p>
            <p className="text-sm text-slate-500 mt-1 max-w-[68ch]">{g.desc}</p>
          </div>
          {g.modules.map((m) => (
            <ModuleCard key={m.id} mod={m} open={openIds.has(m.id)} onToggle={() => toggle(m.id)} />
          ))}
        </section>
      ))}

      <section id={TIP.id} className="scroll-mt-6 space-y-3">
        <div className="pt-2">
          <p className="text-[11px] font-mono uppercase tracking-widest text-brand-600">Consejo de uso</p>
          <p className="text-sm text-slate-500 mt-1 max-w-[68ch]">Un detalle de interfaz que vale la pena conocer.</p>
        </div>
        <ModuleCard mod={TIP} open={openIds.has(TIP.id)} onToggle={() => toggle(TIP.id)} />
      </section>
    </div>
  );
}
