import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type InputTab = {
  id: string;
  label: string;
  value: string;
};

function createInputTab(index: number): InputTab {
  return { id: `input-${index}`, label: `Tab${index}`, value: "" };
}

function InputsPage() {
  const [tabs, setTabs] = useState<InputTab[]>([createInputTab(1)]);
  const [activeTab, setActiveTab] = useState("input-1");

  function addTab() {
    const nextIndex = tabs.length + 1;
    const nextTab = createInputTab(nextIndex);
    setTabs((current) => [...current, nextTab]);
    setActiveTab(nextTab.id);
  }

  function updateTabValue(id: string, value: string) {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, value } : tab)));
  }

  return (
    <div className="flex min-h-full w-full flex-1 flex-col pt-10">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Tabs className="min-h-0 flex-1 gap-0" onValueChange={setActiveTab} value={activeTab}>
          <div className="flex items-center border-border border-b px-2">
            <TabsList
              className="min-w-0 flex-1 justify-start overflow-x-auto overflow-y-hidden"
              variant="line"
            >
              {tabs.map((tab) => (
                <TabsTrigger className="max-w-40 shrink-0" key={tab.id} value={tab.id}>
                  <span className="truncate">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              aria-label="新增输入 tab"
              className="ml-1 size-8 shrink-0"
              onClick={addTab}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Plus className="size-4" />
            </Button>
          </div>

          {tabs.map((tab) => (
            <TabsContent
              className="flex min-h-0 flex-1 flex-col p-4 sm:p-5"
              key={tab.id}
              value={tab.id}
            >
              <Textarea
                aria-label={`${tab.label}输入内容`}
                className="min-h-0 flex-1 resize-none bg-background font-mono text-sm leading-6"
                onChange={(event) => updateTabValue(tab.id, event.target.value)}
                placeholder="输入或粘贴内容…"
                value={tab.value}
              />
              <div className="mt-2 text-right text-muted-foreground text-xs">
                {tab.value.length.toLocaleString()} 个字符
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </div>
  );
}

export { InputsPage };
