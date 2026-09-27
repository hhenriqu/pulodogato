"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

// A barra de abas empurrava a PAGINA para o lado no celular (HMO-168).
//
// O tamanho dela e o do conteudo: `inline-flex` mais `whitespace-nowrap` em
// cada aba. Cinco abas de relatorio somam 496px e nao existe largura de celular
// que caiba nisso -- a barra vazava para fora da viewport e levava a tela toda
// com ela, entao a pessoa arrastava o dedo e o cabecalho saia do lugar. A
// versao `grid w-full` nao escapa: o trilho de grid cresce para o conteudo
// minimo, e "Gastos Compartilhados" sem quebra tem um minimo largo.
//
// `max-w-full` prende a barra na largura do pai e `overflow-x-auto` faz o que
// falta acontecer DENTRO dela: as abas rolam, a pagina nao. E aqui `justify-start`
// nao e enfeite -- com `justify-center` o conteudo que estoura sobra dos DOIS
// lados e a parte da esquerda fica fora de alcance, porque nao ha scroll
// negativo. Enquanto a barra cabe, as duas opcoes sao indistinguiveis (a caixa
// tem a largura do conteudo).
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 max-w-full items-center justify-start overflow-x-auto rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
