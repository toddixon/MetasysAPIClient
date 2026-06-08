import { Component, inject, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { StreamService } from '../../stream.service';
import { StoredStreamEvent } from '../../models/stream.models';
import { combineLatest, map } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

type FilterType = 'all' | 'object.values.update' | 'object.values.heartbeat' | 'hello' | 'error' | 'message';

@Component({
  selector: 'app-stream-events-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatBadgeModule,
    MatDividerModule,
  ],
  templateUrl: './stream-events-dialog.component.html',
  styleUrl: './stream-events-dialog.component.scss',
})
export class StreamEventsDialogComponent {
  private _streamService = inject(StreamService);

  public activeFilter: WritableSignal<FilterType> = signal('all');
  public expandedIndex: WritableSignal<number | null> = signal(null);

  public eventLog$ = this._streamService.streamEventLog$.asObservable();
  public eventCount$ = this.eventLog$.pipe(map(log => log.length));
  public filteredLog$ = combineLatest([
    this.eventLog$,
    toObservable(this.activeFilter),
  ]).pipe(
    map(([log, filter]) => {
      if (filter === 'all') return log;
      if (filter === 'object.values.heartbeat') {
        return log.filter(e => e.type === 'object.values.heartbeat' || e.type === 'object.values.heartbeatImproved');
      }
      return log.filter(e => e.type === filter);
    }),
  );

  public setFilter(filter: FilterType): void {
    this.activeFilter.set(filter);
    this.expandedIndex.set(null);
  }

  public toggleExpand(index: number): void {
    this.expandedIndex.set(this.expandedIndex() === index ? null : index);
  }

  public clearLog(): void {
    this._streamService.clearEventLog();
    this.expandedIndex.set(null);
  }

  public formatTimestamp(date: Date): string {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  public getItemAttributes(item: Record<string, any>): { key: string; value: any }[] {
    return Object.entries(item)
      .filter(([k]) => k !== 'id' && k !== 'itemReference')
      .map(([key, value]) => ({ key, value: typeof value === 'object' ? JSON.stringify(value) : value }));
  }

  public getSummary(event: StoredStreamEvent): string {
    if (event.type === 'object.values.update' && event.parsed) {
      const count = event.parsed.length;
      const first = event.parsed[0];
      const ref = (first?.item as any)?.itemReference ?? '';
      return count === 1 ? ref : `${ref} (+${count - 1} more)`;
    }
    return event.rawData ?? '';
  }
}
