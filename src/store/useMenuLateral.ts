import { create } from 'zustand'

/**
 * Si la barra lateral está abierta. Sólo importa en móvil.
 *
 * En pantalla grande la barra está siempre puesta y esto no se mira. En un teléfono no
 * cabe —son 256px de 360—, así que se sale de la pantalla y se abre con el botón de la
 * barra de arriba. El estado vive aquí y no en el layout porque quien lo abre (la barra
 * de arriba) y quien se pinta (la lateral) son dos componentes hermanos.
 */
interface MenuLateral {
  abierta: boolean
  abrir: () => void
  cerrar: () => void
  alternar: () => void
}

export const useMenuLateral = create<MenuLateral>((set) => ({
  abierta: false,
  abrir: () => set({ abierta: true }),
  cerrar: () => set({ abierta: false }),
  alternar: () => set((e) => ({ abierta: !e.abierta })),
}))
