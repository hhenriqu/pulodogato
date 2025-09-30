import Image from "next/image";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <Image
            src="/logo_pulodogato.png"
            alt="Pulo do Gato"
            width={80}
            height={80}
            className="opacity-75"
          />
        </div>

        {/* Título */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
            Você está offline
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Sem conexão com a internet. Algumas funcionalidades podem estar
            limitadas.
          </p>
        </div>

        {/* Ilustração offline */}
        <div className="flex justify-center py-8">
          <div className="relative">
            <div className="w-24 h-24 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-gray-400 dark:text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192L5.636 18.364M12 2.25a9.75 9.75 0 100 19.5 9.75 9.75 0 000-19.5z"
                />
              </svg>
            </div>
            {/* Sinal Wi-Fi riscado */}
            <div className="absolute -top-2 -right-2">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Informações úteis */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-left space-y-2">
          <h3 className="font-medium text-blue-800 dark:text-blue-200">
            O que você pode fazer offline:
          </h3>
          <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>• Visualizar dados salvos anteriormente</li>
            <li>• Navegar entre páginas já visitadas</li>
            <li>• Usar calculadoras financeiras básicas</li>
          </ul>
        </div>

        {/* Botões de ação */}
        <div className="space-y-3">
          <Link
            href="/dashboard"
            className="block w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg transition-colors text-center"
          >
            Ir para o Dashboard
          </Link>

          <noscript>
            <p className="text-sm text-gray-500">
              Recarregue a página quando a conexão for restaurada.
            </p>
          </noscript>
        </div>

        {/* Status de conectividade */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          <div
            id="connection-status"
            className="flex items-center justify-center gap-2"
          >
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span>Desconectado</span>
          </div>
        </div>
      </div>

      {/* Script será adicionado no lado cliente */}
    </div>
  );
}
