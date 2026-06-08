import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, NgZone, OnDestroy, QueryList, ViewChildren } from '@angular/core';
import { NavigationTreeService } from '../navigation-tree.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from "@angular/material/button";
import { ObjectManagerService } from '../objectManager.service';
import { catchError, map, Observable, of, shareReplay, Subscription, tap } from 'rxjs';
import { skeletonTheme } from '../constants/ngxSkeleton.consants';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DynamicFormComponent } from "../dynamic-form/dynamic-form.component";
import { DisplayItem } from '../models/display.models';

@Component({
  selector: 'app-display',
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatButtonToggleModule,
    MatDividerModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    DynamicFormComponent,
  ],
  templateUrl: './display.component.html',
  styleUrl: './display.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DisplayComponent implements AfterViewInit, OnDestroy {
  @ViewChildren(DynamicFormComponent) displayItems!: QueryList<DynamicFormComponent>;
  @ViewChildren('card') private _cardRefs!: QueryList<ElementRef<HTMLElement>>;

  public dataViewType: "Formatted" | "Raw" = "Formatted";

  private _navTreeService = inject(NavigationTreeService);
  private _sanitizer = inject(DomSanitizer);
  private _objectManagerService = inject(ObjectManagerService);
  private _zone = inject(NgZone);
  public ngxSkeletonTheme = skeletonTheme;

  public displayViews$: Observable<Array<DisplayItem>>;

  /** Masonry: matches grid-auto-rows in display.component.scss */
  private readonly _ROW_SIZE = 8;
  /** Masonry: matches column-gap (1.5rem at 16px base) */
  private readonly _COL_GAP = 24;

  private _resizeObserver?: ResizeObserver;
  private _rafId?: number;
  private _cardRefsSub?: Subscription;

  constructor() {
    this.displayViews$ = this._navTreeService.displayedNodesData$.pipe(
      tap((data) => {
        console.log(data);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
  }

  ngAfterViewInit(): void {
    // Run masonry outside Angular's zone — we only touch DOM styles, no CD needed.
    this._zone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this._setupMasonry();
        this._cardRefsSub = this._cardRefs.changes.subscribe(() => this._setupMasonry());
      });
    });
  }

  ngOnDestroy(): void {
    this._resizeObserver?.disconnect();
    this._cardRefsSub?.unsubscribe();
    if (this._rafId !== undefined) cancelAnimationFrame(this._rafId);
  }

  private _setupMasonry(): void {
    this._resizeObserver?.disconnect();

    if (this._cardRefs.length < 2) {
      // Single item: clear any stale spans so normal flow is restored.
      this._cardRefs.forEach(ref => { ref.nativeElement.style.gridRowEnd = ''; });
      return;
    }

    this._resizeObserver = new ResizeObserver(() => this._scheduleSpanUpdate());
    this._cardRefs.forEach(ref => this._resizeObserver!.observe(ref.nativeElement));
    this._updateSpans();
  }

  /**
   * Debounce span recalculations to one write per animation frame.
   * Prevents layout thrash when multiple cards resize simultaneously (e.g. during expand/collapse animation).
   */
  private _scheduleSpanUpdate(): void {
    if (this._rafId !== undefined) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => {
      this._updateSpans();
      this._rafId = undefined;
    });
  }

  /**
   * Set grid-row-end: span N on each card so it claims only as many grid rows as
   * its content needs. The +COL_GAP in the numerator reserves space for the gap
   * between cards in the same column (since row-gap is 0 on the grid).
   */
  private _updateSpans(): void {
    this._cardRefs.forEach(ref => {
      const el = ref.nativeElement;
      const height = el.getBoundingClientRect().height;
      if (!height) return;
      el.style.gridRowEnd = `span ${Math.ceil((height + this._COL_GAP) / this._ROW_SIZE)}`;
    });
  }

  getObjectAttribute(id: string, attribute: string): Observable<any> {
    return this._objectManagerService.watchAttributeValue(id, attribute).pipe(
      map((value) => {
        console.log(value);
        return { attributeName: attribute, value: value };
      }),
      catchError((err) => {
        return of(err);
      }),
    );
  }

  public onCopyEvent(selectedObjectIds: string[]) {
    let f = selectedObjectIds;
  }
}
